/* @flow */

import { join } from 'path';

import {
    gt as greaterThanVersion,
    lt as lessThanVersion,
    rcompare as compareVersionsDescending,
    major
} from 'semver';
import LRU from 'lru-cache';
import { readFile } from 'fs-extra';

import type { LoggerType, CacheType } from './types';
import { install, info, type Package, clearCache } from './npm';
import { poll, createHomeDirectory, resolveNodeModulesDirectory, resolveModuleDirectory, isValidDependencyVersion, identity, dynamicRequire, dynamicRequireRelative } from './util';
import { LIVE_MODULES_DIR_NAME, NPM_POLL_INTERVAL, NPM_REGISTRY } from './config';
import { DIST_TAG, NODE_MODULES, PACKAGE_JSON, DIST_TAGS } from './constants';

type InstallResult = {|
    nodeModulesPath : string,
    modulePath : string,
    dependencies : {
        [string] : {|
            version : string,
            path : string
        |}
    }
|};

function cleanName(name : string) : string {
    return name.replace(/\//g, '-');
}

type InstallVersionOptions = {|
    moduleInfo : Package,
    version : string,
    dependencies? : boolean,
    logger : LoggerType,
    cache : ?CacheType,
    registry : string,
    cdnRegistry : ?string,
    childModules : ?$ReadOnlyArray<string>,
    prefix : string
|};

async function installVersion({ moduleInfo, version, dependencies = false, registry = NPM_REGISTRY, logger, cache, prefix, cdnRegistry, childModules } : InstallVersionOptions) : Promise<InstallResult> {
    await install(moduleInfo.name, version, { logger, cache, dependencies, registry, cdnRegistry, prefix, childModules });
    
    const nodeModulesPath = join(prefix, NODE_MODULES);
    const modulePath = join(nodeModulesPath, moduleInfo.name);
    const moduleDependencies = {};

    const versionInfo = moduleInfo.versions[version];

    for (const dependencyName of Object.keys(versionInfo.dependencies)) {
        moduleDependencies[dependencyName] = {
            version: versionInfo.dependencies[dependencyName],
            path:    join(nodeModulesPath, dependencyName)
        };
    }

    return {
        nodeModulesPath,
        modulePath,
        dependencies: moduleDependencies
    };
}

type ModuleDetails = {|
    nodeModulesPath : string,
    modulePath : string,
    version : string,
    previousVersion : string,
    dependencies : {
        [string] : {|
            version : string,
            path : string
        |}
    }
|};

type DistPoller = {|
    result : () => Promise<ModuleDetails>,
    stop : () => void
|};

type PollInstallDistTagOptions = {|
    name : string,
    tag : string,
    onError : ?(mixed) => void,
    period? : number,
    dependencies? : boolean,
    logger : LoggerType,
    cache : ?CacheType,
    registry : string,
    cdnRegistry : ?string,
    childModules : ?$ReadOnlyArray<string>
|};

function pollInstallDistTag({ name, onError, tag, period = 20, dependencies = false, logger, cache, registry = NPM_REGISTRY, cdnRegistry, childModules } : PollInstallDistTagOptions) : DistPoller {
    const pollInstall = async () : Promise<ModuleDetails> => {
        const { moduleInfo } = await info(name, { logger, cache, registry, cdnRegistry });

        const currentVersion = moduleInfo[DIST_TAGS][tag];

        if (!currentVersion) {
            throw new Error(`No ${ tag } tag found for ${ name } - ${ JSON.stringify(moduleInfo[DIST_TAGS]) }`);
        }

        const isVersionEligible = version => {
            const doVersionsShareMajor = major(version) === major(currentVersion);
            const isVersionLessThanCurrent = lessThanVersion(version, currentVersion);

            return isValidDependencyVersion(version) && doVersionsShareMajor && isVersionLessThanCurrent;
        };

        const eligibleVersions = Object.keys(moduleInfo.versions)
            .filter(isVersionEligible)
            .sort(compareVersionsDescending);

        const previousVersions = eligibleVersions.filter(version => greaterThanVersion(currentVersion, version));
        const previousVersion = previousVersions.length ? previousVersions[0] : eligibleVersions[0];
        const cdnRegistryLabel = cdnRegistry ? new URL(cdnRegistry).hostname : '';
        const liveModulesDir = await createHomeDirectory(join(LIVE_MODULES_DIR_NAME, cdnRegistryLabel));
        const prefix = join(liveModulesDir, `${ cleanName(moduleInfo.name) }_${ currentVersion }`);

        const { nodeModulesPath, modulePath, dependencies: moduleDependencies } = await installVersion({
            cache,
            cdnRegistry,
            childModules,
            dependencies,
            logger,
            moduleInfo,
            prefix,
            registry,
            version: currentVersion
        });

        return {
            modulePath,
            nodeModulesPath,
            previousVersion,
            dependencies: moduleDependencies,
            version:      currentVersion
        };
    };

    const poller = poll({
        handler: pollInstall,
        period:  period * 1000,
        onError
    }).start();

    return {
        stop:       () => {
            poller.stop();
        },
        result:     async () => await poller.result()
    };
}

type NpmWatcher<T : Object> = {|
    get : (tag? : string) => Promise<ModuleDetails>,
    read : (path? : string) => Promise<string>,
    import : (?string) => Promise<T>,
    importDependency : (string, ?string) => Promise<T>,
    cancel : () => void
|};

type NPMPollOptions = {|
    name : string,
    tags? : $ReadOnlyArray<string>,
    onError? : (mixed) => void,
    period? : number,
    fallback? : boolean,
    logger? : LoggerType,
    cache? : CacheType,
    registry? : string,
    cdnRegistry? : string,
    dependencies? : boolean,
    childModules? : $ReadOnlyArray<string>
|};

export const defaultLogger : LoggerType = {
    debug: (...args : $ReadOnlyArray<mixed>) => console.debug(...args), // eslint-disable-line no-console
    info:  (...args : $ReadOnlyArray<mixed>) => console.info(...args),  // eslint-disable-line no-console
    warn:  (...args : $ReadOnlyArray<mixed>) => console.warn(...args), // eslint-disable-line no-console
    error: (...args : $ReadOnlyArray<mixed>) => console.error(...args) // eslint-disable-line no-console
};

export async function getFallback(name : string) : Promise<ModuleDetails> {
    const modulePath = resolveModuleDirectory(name);
    const nodeModulesPath = await resolveNodeModulesDirectory(name);

    if (!modulePath) {
        throw new Error(`Can not find module path for fallback for ${ name }`);
    }

    if (!nodeModulesPath) {
        throw new Error(`Can not find node modules path for fallback for ${ name }`);
    }

    // $FlowFixMe
    const pkg = require(join(modulePath, PACKAGE_JSON)); // eslint-disable-line security/detect-non-literal-require
    const version = pkg.version;
    const dependencies = {};

    for (const dependencyName of Object.keys(pkg.dependencies || {})) {
        const dependencyPath = resolveModuleDirectory(dependencyName, [ modulePath ]); // join(nodeModulesPath, dependencyName);

        if (!dependencyPath) {
            throw new Error(`Can not resolve dependency for fallback: ${ dependencyName } / ${ modulePath }`);
        }

        // $FlowFixMe
        const dependencyPkg = require(join(dependencyPath, PACKAGE_JSON)); // eslint-disable-line security/detect-non-literal-require

        dependencies[dependencyName] = {
            version: dependencyPkg.version,
            path:    dependencyPath
        };
    }

    return {
        nodeModulesPath,
        modulePath,
        version,
        previousVersion: version,
        dependencies
    };
}

export function npmPoll({ name, tags = [ DIST_TAG.LATEST ], onError, period = NPM_POLL_INTERVAL, registry = NPM_REGISTRY, logger = defaultLogger, cache, dependencies = false, fallback = true, cdnRegistry, childModules } : NPMPollOptions) : NpmWatcher<Object> {

    const pollers = {};

    for (const tag of tags) {
        pollers[tag] = pollInstallDistTag({ name, tag, onError, period, dependencies, registry, logger, cache, cdnRegistry, childModules });
    }

    async function withPoller<T>(handler : <T>(ModuleDetails) => Promise<T> | T, tag : ?string) : Promise<T> {
        if (tag && !pollers[tag]) {
            throw new Error(`Invalid tag: ${ tag }`);
        }

        if (!tag) {
            if (tags.length === 1) {
                tag = tags[0];
            } else if (pollers[DIST_TAG.LATEST]) {
                tag = DIST_TAG.LATEST;
            } else {
                throw new Error(`Please specify tag: one of ${ tags.join(', ') }`);
            }
        }

        const poller = pollers[tag || DIST_TAG.LATEST];

        try {
            return await handler(await poller.result());
        } catch (err) {
            logger.warn('grabthar_poll_error_fallback', { err: err.stack || err.toString() });

            if (fallback && resolveNodeModulesDirectory(name)) {
                try {
                    return await handler(await getFallback(name));
                } catch (fallbackErr) {
                    throw new Error(`${ err.stack }\n\nFallback failed:\n\n${ fallbackErr.stack }`);
                }
            }

            throw err;
        }
    }

    async function pollerGet(tag? : ?string) : Promise<ModuleDetails> {
        return await withPoller(identity, tag);
    }

    async function pollerImport <T : Object>(path, tag? : ?string) : Promise<T> {
        return await withPoller(({ modulePath }) => {
            const fullPath = path ? join(modulePath, path) : modulePath;

            return dynamicRequire(fullPath);
        }, tag);
    }

    async function pollerImportDependency <T : Object>(dependencyName, path, tag? : ?string) : Promise<T> {
        return await withPoller(async ({ modulePath }) => {
            const nodeModulesDir = await resolveNodeModulesDirectory(modulePath);

            if (!nodeModulesDir) {
                throw new Error(`Can not find node modules for ${ modulePath }`);
            }

            const relativePath = path ? join(dependencyName, path) : dependencyName;
            return dynamicRequireRelative(relativePath, nodeModulesDir);
        }, tag);
    }

    const readCache = new LRU(20);

    async function pollerRead(path? : string, tag? : ?string) : Promise<string> {
        return await withPoller(async ({ modulePath }) => {
            const filePath = join(modulePath, path || '');
            if (readCache.has(filePath)) {
                return readCache.get(filePath);
            }
            const file = await readFile(filePath);
            readCache.set(filePath, file);
            return file;
        }, tag);
    }

    function pollerCancel() {
        for (const tag of tags) {
            pollers[tag].stop();
        }
    }

    return {
        get:              pollerGet,
        import:           pollerImport,
        importDependency: pollerImportDependency,
        read:             pollerRead,
        cancel:           pollerCancel
    };
}

npmPoll.flushCache = () => {
    clearCache();
};
