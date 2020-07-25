/* @flow */

import { join } from 'path';

import compareVersions from 'compare-versions';
import LRU from 'lru-cache';
import { readFile } from 'fs-extra';

import type { LoggerType, CacheType } from './types';
import { install, info, type Package, clearCache } from './npm';
import { poll, createHomeDirectory, resolveNodeModulesDirectory, resolveModuleDirectory, isValidDependencyVersion, identity } from './util';
import { MODULE_ROOT_NAME, NPM_POLL_INTERVAL, NPM_REGISTRY } from './config';
import { DIST_TAG, NODE_MODULES, STABILITY, PACKAGE_JSON, DIST_TAGS } from './constants';

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
    cdnRegistry : ?string
|};

async function installVersion({ moduleInfo, version, dependencies = false, registry = NPM_REGISTRY, logger, cache, cdnRegistry } : InstallVersionOptions) : Promise<InstallResult> {
    const newRoot = await createHomeDirectory(MODULE_ROOT_NAME, `${ cleanName(moduleInfo.name) }_${ version }`);

    await install(moduleInfo.name, version, { logger, cache, dependencies, registry, cdnRegistry, prefix: newRoot });
    
    const nodeModulesPath = join(newRoot, NODE_MODULES);
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
    stop : () => void,
    markStable : (string) => void,
    markUnstable : (string) => void
|};

function getMajorVersion(version : string) : string {
    return version.split('.')[0];
}

type PollInstallDistTagOptions = {|
    name : string,
    tag : string,
    onError : ?(Error) => void,
    period? : number,
    dependencies? : boolean,
    logger : LoggerType,
    cache : ?CacheType,
    registry : string,
    cdnRegistry : ?string
|};

function pollInstallDistTag({ name, onError, tag, period = 20, dependencies = false, logger, cache, registry = NPM_REGISTRY, cdnRegistry } : PollInstallDistTagOptions) : DistPoller {
    
    const stability : { [string] : string } = {};

    const pollInstall = async () : Promise<ModuleDetails> => {
        const moduleInfo = await info(name, { logger, cache, registry, cdnRegistry });

        let distTagVersion = moduleInfo[DIST_TAGS][tag];

        if (!distTagVersion) {
            throw new Error(`No ${ tag } tag found for ${ name } - ${ JSON.stringify(moduleInfo[DIST_TAGS]) }`);
        }

        const moduleVersions = Object.keys(moduleInfo.versions)
            .filter(ver => ver.match(/^\d+\.\d+\.\d+$/))
            .sort(compareVersions)
            .reverse();

        stability[distTagVersion] = stability[distTagVersion] || STABILITY.STABLE;
        const majorVersion = getMajorVersion(distTagVersion);

        const eligibleVersions = moduleVersions.filter(ver => {
                
            // Only allow x.x.x versions
            if (!isValidDependencyVersion(ver)) {
                return false;
            }

            // Do not allow versions that are not the major version of the dist-tag
            if (getMajorVersion(ver) !== majorVersion) {
                return false;
            }

            // Do not allow versions ahead of the current dist-tag
            if (compareVersions(ver, distTagVersion) === 1) {
                return false;
            }

            // Do not allow versions marked as unstable
            if (stability[ver] === STABILITY.UNSTABLE) {
                return false;
            }

            return true;
        });

        if (!eligibleVersions.length) {
            throw new Error(`No eligible versions found for module ${ name } -- from [ ${ moduleVersions.join(', ') } ]`);
        }

        const stableVersions = eligibleVersions.filter(ver => {
            if (stability[ver] === STABILITY.UNSTABLE) {
                return false;
            }

            return true;
        });

        if (!stableVersions.length) {
            throw new Error(`No eligible versions found for module ${ name } -- from [ ${ moduleVersions.join(', ') } ]`);
        }

        const previousVersions = stableVersions.filter(ver => {
            return compareVersions(distTagVersion, ver) === 1;
        });
            
        const previousVersion = previousVersions.length ? previousVersions[0] : eligibleVersions[0];

        if (stability[distTagVersion] === STABILITY.UNSTABLE) {
            if (!previousVersion) {
                throw new Error(`${ name }@${ distTagVersion } and no previous stable version to fall back on`);
            }

            distTagVersion = previousVersion;
        }

        const version = distTagVersion;
        const { nodeModulesPath, modulePath, dependencies: moduleDependencies } = await installVersion({
            moduleInfo, version, dependencies, registry, logger, cache, cdnRegistry
        });

        return {
            nodeModulesPath,
            modulePath,
            version,
            previousVersion,
            dependencies: moduleDependencies
        };
    };

    const poller = poll({
        handler: pollInstall,
        period:  period * 1000,
        onError
    }).start();

    return {
        stop:       () => { poller.stop(); },
        result:     async () => await poller.result(),
        markStable: (version : string) => {
            stability[version] = STABILITY.STABLE;
        },
        markUnstable: (version : string) => {
            stability[version] = STABILITY.UNSTABLE;
        }
    };
}

type NpmWatcher<T : Object> = {|
    get : (tag? : string) => Promise<ModuleDetails>,
    read : (path? : string) => Promise<string>,
    import : (?string) => Promise<T>,
    importDependency : (string, ?string) => Promise<T>,
    cancel : () => void,
    markStable : (string) => void,
    markUnstable : (string) => void
|};

type NPMPollOptions = {|
    name : string,
    tags? : $ReadOnlyArray<string>,
    onError? : (Error) => void,
    period? : number,
    fallback? : boolean,
    logger? : LoggerType,
    cache? : CacheType,
    registry? : string,
    cdnRegistry? : string,
    dependencies? : boolean
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

export function npmPoll({ name, tags = [ DIST_TAG.LATEST ], onError, period = NPM_POLL_INTERVAL, registry = NPM_REGISTRY, logger = defaultLogger, cache, dependencies = false, fallback = true, cdnRegistry } : NPMPollOptions) : NpmWatcher<Object> {

    const pollers = {};

    for (const tag of tags) {
        pollers[tag] = pollInstallDistTag({ name, tag, onError, period, dependencies, registry, logger, cache, cdnRegistry });
    }

    async function withPoller<T>(handler : <T>(ModuleDetails) => Promise<T> | T, tag? : ?string) : Promise<T> {
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

    async function pollerImport <T : Object>(path = '') : Promise<T> {
        return await withPoller(({ modulePath }) => {
            // $FlowFixMe
            return require(join(modulePath, path)); // eslint-disable-line security/detect-non-literal-require
        });
    }

    async function pollerImportDependency <T : Object>(dependencyName, path = '') : Promise<T> {
        return await withPoller(async ({ modulePath }) => {
            // $FlowFixMe
            return require(join(await resolveNodeModulesDirectory(modulePath), dependencyName, path)); // eslint-disable-line security/detect-non-literal-require
        });
    }

    const readCache = new LRU(20);

    async function pollerRead(path? : string = '') : Promise<string> {
        return await withPoller(async ({ modulePath }) => {
            const filePath = join(modulePath, path);
            if (readCache.has(filePath)) {
                return readCache.get(filePath);
            }
            const file = await readFile(filePath);
            readCache.set(filePath, file);
            return file;
        });
    }

    function pollerCancel() {
        for (const tag of tags) {
            pollers[tag].stop();
        }
    }

    function pollerMarkStable(version : string) {
        for (const tag of tags) {
            pollers[tag].markStable(version);
        }
    }

    function pollerMarkUnstable(version : string) {
        for (const tag of tags) {
            pollers[tag].markUnstable(version);
        }
    }

    return {
        get:              pollerGet,
        import:           pollerImport,
        importDependency: pollerImportDependency,
        read:             pollerRead,
        cancel:           pollerCancel,
        markStable:       pollerMarkStable,
        markUnstable:     pollerMarkUnstable
    };
}

npmPoll.flushCache = () => {
    clearCache();
};
