/* @flow */
/* eslint const-immutable/no-mutation: off */

import { join } from 'path';
import { tmpdir } from 'os';

import { ensureDir, move, existsSync, exists, remove, ensureFileSync } from 'fs-extra';
import download from 'download';
import fetch from 'node-fetch';
import uuid from 'uuid';

import type { CacheType, LoggerType } from './types';
import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT, CDN_REGISTRY_INFO_FILENAME, CDN_REGISTRY_INFO_CACHEBUST_URL_TIME } from './config';
import { NPM, NODE_MODULES, PACKAGE, PACKAGE_JSON, LOCK } from './constants';
import { npmRun, sanitizeString,
    stringifyCommandLineOptions, lookupDNS, cacheReadWrite, clearObject, rmrf, useFileSystemLock, isValidDependencyVersion } from './util';

process.env.NO_UPDATE_NOTIFIER = 'true';

export type NpmOptionsType = {|
    prefix? : string,
    registry? : string,
    cache? : string,
    json? : boolean,
    production? : boolean,
    silent? : boolean
|};

const DEFAULT_NPM_OPTIONS : NpmOptionsType = {
    silent:     true,
    json:       true,
    production: true,
    cache:      NPM_CACHE_DIR,
    registry:   NPM_REGISTRY
};

const getDefaultNpmOptions = () : NpmOptionsType => {
    // $FlowFixMe
    return {};
};

const verifyCache : { [string] : Promise<void> } = {};

const verifyRegistry = async (domain : string) : Promise<void> => {
    verifyCache[domain] = verifyCache[domain] || (async () => {
        await lookupDNS(domain);
        const res = await fetch(`${ domain }/info`);
        delete verifyCache[domain];
        if (res.status !== 200) {
            throw new Error(`Got ${ res.status } from ${ domain }/info`);
        }
    })();

    await verifyCache[domain];
};


export async function npm(command : string, args : $ReadOnlyArray<string> = [], npmOptions : ?NpmOptionsType = getDefaultNpmOptions(), timeout? : number = NPM_TIMEOUT) : Promise<Object> {
    npmOptions = { ...DEFAULT_NPM_OPTIONS, ...npmOptions };

    if (!npmOptions.registry) {
        throw new Error(`Expected npm registry to be passed`);
    }

    await verifyRegistry(npmOptions.registry);

    const cmdstring = `${ NPM } ${ command } ${ args.join(' ') } ${ stringifyCommandLineOptions(npmOptions) }`;

    const cmdoptions = {
        timeout,
        env: process.env
    };
    
    const result = await npmRun(cmdstring, cmdoptions);

    return JSON.parse(result);
}

export type Package = {|
    'name' : string,
    'versions' : {
        [string] : {|
            'dependencies' : {
                [ string ] : string
            },
            'dist' : {|
                'tarball' : string
            |}
        |}
    },
    'dist-tags' : {
        [ string ] : string
    }
|};

function extractInfo(moduleInfo : Package) : Package {
    const { name, versions: npmVersions, 'dist-tags': distTags } = moduleInfo;

    const versions = {};
    for (const version of Object.keys(npmVersions)) {
        const versionData = npmVersions[version];
        const { dependencies, dist } = versionData;
        const { tarball } = dist;

        versions[version] = {
            dependencies,
            dist: { tarball }
        };
    }

    return { name, versions, 'dist-tags': distTags };
}

type InfoOptions = {|
    npmOptions : NpmOptionsType | void,
    cache : ?CacheType,
    logger : LoggerType,
    cdnRegistry : ?string
|};

const infoCache : { [string] : Promise<Package> } = {};

export async function info(moduleName : string, opts : InfoOptions) : Promise<Package> {
    const { npmOptions = getDefaultNpmOptions(), logger, cache, cdnRegistry } = opts;
    const memoryCacheKey = JSON.stringify({ moduleName, npmOptions });
    const { registry = NPM_REGISTRY } = npmOptions;

    infoCache[memoryCacheKey] = infoCache[memoryCacheKey] || (async () => {
        const sanitizedName = sanitizeString(moduleName);
        const sanitizedCDNRegistry = sanitizeString(cdnRegistry || 'npm');

        const cacheKey = `grabthar_npm_info_${ sanitizedName }_${ sanitizedCDNRegistry }`;
        logger.info(`grabthar_npm_info_${ sanitizedName }`, { registry });

        const { name, versions, 'dist-tags': distTags } = await cacheReadWrite(cacheKey, async () => {

            let res;

            if (cdnRegistry) {
                res = await fetch(`${ cdnRegistry }/${ moduleName.replace('@', '') }/${ CDN_REGISTRY_INFO_FILENAME }?cache-bust=${ Math.floor(Date.now() / CDN_REGISTRY_INFO_CACHEBUST_URL_TIME) }`);
                if (!res.ok) {
                    logger.info(`grabthar_cdn_registry_failure`, {
                        cdnRegistry, moduleName, status: res.status
                    });
                    res = null;
                }
            }

            if (!res) {
                res = await fetch(`${ registry }/${ moduleName }`);
            }

            if (!res.ok) {
                throw new Error(`npm returned status ${ res.status || 'unknown' } for ${ registry }/${ moduleName }`);
            }

            return extractInfo(await res.json());

        }, { logger, cache });

        return { name, versions, 'dist-tags': distTags };
    })();

    try {
        return await infoCache[memoryCacheKey];
    } finally {
        delete infoCache[memoryCacheKey];
    }
}

type InstallOptions = {|
    npmOptions : NpmOptionsType,
    logger : LoggerType,
    cache? : ?CacheType,
    dependencies? : boolean,
    flat? : boolean,
    cdnRegistry : ?string
|};

export const installSingle = async (moduleName : string, version : string, opts : InstallOptions) : Promise<void> => {

    if (!isValidDependencyVersion(version)) {
        throw new Error(`Invalid version for single install: ${ moduleName }@${ version }`);
    }

    const { npmOptions = getDefaultNpmOptions(), cache, logger, cdnRegistry } = opts;

    const moduleInfo = await info(moduleName, { npmOptions, cache, logger, cdnRegistry });

    const versionInfo = moduleInfo.versions[version];
    const tarball = versionInfo.dist.tarball;
    const { prefix, registry } = npmOptions;

    if (!prefix) {
        throw new Error(`Prefix required for flat install`);
    }

    if (!tarball) {
        throw new Error(`Can not find tarball for ${ moduleInfo.name }`);
    }

    const sanitizedName = sanitizeString(moduleName);
    logger.info(`grabthar_npm_install_flat_${ sanitizedName }`, { version, registry, prefix });

    const nodeModulesDir = join(prefix, NODE_MODULES);
    const packageName = `${ PACKAGE }.tar.gz`;

    const tmpDir = join(tmpdir(), uuid.v4().slice(10));
    const packageDir = join(tmpDir, PACKAGE);
    const moduleDir = join(nodeModulesDir, moduleInfo.name);
    const modulePackageDir = join(moduleDir, PACKAGE_JSON);
    const moduleLock = join(moduleDir, LOCK);
    const moduleParentDir = join(moduleDir, '..');

    await ensureDir(tmpDir);
    await ensureDir(prefix);
    await ensureDir(nodeModulesDir);
    await ensureDir(moduleParentDir);

    if (await exists(modulePackageDir)) {
        return;
    }

    if (existsSync(moduleLock)) {
        throw new Error(`${ moduleDir } is locked, can not install ${ moduleName }`);
    }

    ensureFileSync(moduleLock);
    const lockTimer = setTimeout(async () => {
        await remove(moduleLock);
    }, 60 * 1000);

    if (await exists(moduleDir)) {
        await rmrf(moduleDir);
    }

    try {
        await ensureDir(moduleDir);
        await download(tarball, tmpDir, { extract: true, filename: packageName });
        await move(packageDir, moduleDir, { overwrite: true });
        if (!await exists(modulePackageDir)) {
            throw new Error(`Package not found at ${ modulePackageDir }`);
        }
    } catch (err) {
        await rmrf(moduleDir);
        throw err;
    } finally {
        await remove(moduleLock);
        clearTimeout(lockTimer);
    }
};

export const installFlat = async (moduleName : string, version : string, opts : InstallOptions) : Promise<void> => {
    const { npmOptions, cache, logger, dependencies = true, cdnRegistry } = opts;

    const tasks = [];

    if (dependencies) {
        const moduleInfo = await info(moduleName, { npmOptions, cache, logger, cdnRegistry });
        const dependencyVersions = moduleInfo.versions[version].dependencies;

        for (const dependencyName of Object.keys(dependencyVersions)) {
            const dependencyVersion = dependencyVersions[dependencyName];
            if (!isValidDependencyVersion(dependencyVersion)) {
                throw new Error(`Invalid dependency version for flat single install: ${ dependencyName }@${ dependencyVersion }`);
            }
        }

        for (const dependencyName of Object.keys(dependencyVersions)) {
            const dependencyVersion = dependencyVersions[dependencyName];
            tasks.push(installSingle(dependencyName, dependencyVersion, opts));
        }
    }

    tasks.push(installSingle(moduleName, version, opts));

    await Promise.all(tasks);
};

export const installFull = async (moduleName : string, version : string, { npmOptions = getDefaultNpmOptions(), logger, cdnRegistry } : InstallOptions) : Promise<void> => {
    const { registry, prefix } = npmOptions;

    if (!prefix) {
        throw new Error(`Prefix required for flat install`);
    }

    if (cdnRegistry) {
        throw new Error(`Can not do full install when using cdnRegistry`);
    }

    const sanitizedName = sanitizeString(moduleName);
    logger.info(`grabthar_npm_install_flat_${ sanitizedName }`, { version, registry, prefix });

    const nodeModulesDir = join(prefix, NODE_MODULES);
    const moduleDir = join(nodeModulesDir, moduleName);
    const modulePackageDir = join(moduleDir, PACKAGE_JSON);

    if (await exists(modulePackageDir)) {
        return;
    }

    logger.info(`grabthar_npm_install_${ sanitizedName }`, { version, registry, prefix });
    await npm('install', [ `${ moduleName }@${ version }` ], npmOptions);
};

export const install = async (moduleName : string, version : string, opts : InstallOptions) : Promise<void> => {
    const { dependencies = true, flat = false, npmOptions, logger, cdnRegistry } = opts;
    const prefix = npmOptions.prefix;

    return await useFileSystemLock(async () => {
        if (flat) {
            if (!prefix) {
                throw new Error(`NPM prefix required for flat install`);
            }

            try {
                return await installFlat(moduleName, version, opts);
            } catch (err) {
                logger.warn('grabthar_install_flat_error_fallback', { err: err.stack || err.toString() });

                if (dependencies && !cdnRegistry) {
                    await rmrf(prefix);
                    return await installFull(moduleName, version, opts);
                }

                throw err;
            }
        } else if (dependencies) {
            return await installFull(moduleName, version, opts);
        } else {
            throw new Error(`Can not install with dependencies=false and flat=false`);
        }
    });
};

export function clearCache() {
    clearObject(verifyCache);
    clearObject(infoCache);
}
