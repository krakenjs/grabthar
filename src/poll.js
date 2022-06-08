/* @flow */

import { join } from 'path';

import LRU from 'lru-cache';
import { readFile } from 'fs-extra';

import type { LoggerType, CacheType } from './types';
import { installVersion, clearCache } from './npm';
import { poll, resolveNodeModulesDirectory, resolveModuleDirectory, identity, dynamicRequire, dynamicRequireRelative } from './util';
import { NPM_POLL_INTERVAL, NPM_REGISTRY } from './config';
import { DIST_TAG, STABILITY, PACKAGE_JSON } from './constants';


let readCache;

const setupReadCache = () => {
    if (!readCache) {
        readCache = new LRU(20);
    }
};

export type ModuleDetails = {|
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
    const stability : { [string] : string } = {};

    const handler = async () : Promise<ModuleDetails> => {
        return await installVersion({
            cache,
            cdnRegistry,
            childModules,
            dependencies,
            logger,
            name,
            registry,
            stability,
            tag
        });
    };

    const poller = poll({
        handler,
        onError,
        period:  period * 1000
    }).start();

    return {
        stop:       () => {
            poller.stop();
        },
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

export const importDependency = async ({ dependencyName, path, moduleDetails } : {|dependencyName : string, path : ?string, moduleDetails : ModuleDetails |}) => {
    const nodeModulesDir = await resolveNodeModulesDirectory(moduleDetails.modulePath);

    if (!nodeModulesDir) {
        throw new Error(`Can not find node modules for ${ moduleDetails.modulePath }`);
    }

    const relativePath = path ? join(dependencyName, path) : dependencyName;

    return dynamicRequireRelative(relativePath, nodeModulesDir);
};

export const importParent = ({ moduleDetails, path } : {|path : ?string, moduleDetails : ModuleDetails|}) => {
    const fullPath = path ? join(moduleDetails.modulePath, path) : moduleDetails.modulePath;

    return dynamicRequire(fullPath);
};


export const getFile = async ({ moduleDetails, path } : {|path : ?string, moduleDetails : ModuleDetails|}) => {
    const filePath = join(moduleDetails.modulePath, path || '');

    setupReadCache();

    if (readCache.has(filePath)) {
        return readCache.get(filePath);
    }

    const file = await readFile(filePath);
    readCache.set(filePath, file);
    return file;
};

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
        return await withPoller(moduleDetails => importParent({ moduleDetails, path }), tag);
    }

    async function pollerImportDependency <T : Object>(dependencyName, path, tag? : ?string) : Promise<T> {
        return await withPoller((moduleDetails) => importDependency({ dependencyName, path, moduleDetails }), tag);
    }

    async function pollerRead(path? : string, tag? : ?string) : Promise<string> {
        return await withPoller((moduleDetails) => getFile({ moduleDetails, path }), tag);
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
