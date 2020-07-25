/* @flow */
/* eslint const-immutable/no-mutation: off */

import { join } from 'path';
import { tmpdir } from 'os';

import { ensureDir, move, existsSync, exists, ensureFileSync } from 'fs-extra';
import download from 'download';
import fetch from 'node-fetch';
import uuid from 'uuid';

import type { CacheType, LoggerType } from './types';
import { NPM_REGISTRY, CDN_REGISTRY_INFO_FILENAME, CDN_REGISTRY_INFO_CACHEBUST_URL_TIME, INFO_MEMORY_CACHE_LIFETIME } from './config';
import { NODE_MODULES, PACKAGE, PACKAGE_JSON, LOCK } from './constants';
import { sanitizeString, cacheReadWrite, rmrf, useFileSystemLock, isValidDependencyVersion, memoizePromise, tryRmrf, tryRemove } from './util';

process.env.NO_UPDATE_NOTIFIER = 'true';

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
    cache : ?CacheType,
    logger : LoggerType,
    registry : string,
    cdnRegistry : ?string
|};

export const info = memoizePromise(async (moduleName : string, opts : InfoOptions) : Promise<Package> => {
    const { logger, cache, registry = NPM_REGISTRY, cdnRegistry } = opts;

    const sanitizedName = sanitizeString(moduleName);
    const sanitizedCDNRegistry = sanitizeString(cdnRegistry || 'npm');

    const cacheKey = `grabthar_npm_info_${ sanitizedName }_${ sanitizedCDNRegistry }`;
    logger.info(`grabthar_npm_info_${ sanitizedName }`, { registry });

    const { name, versions, 'dist-tags': distTags } = await cacheReadWrite(cacheKey, async () => {
        let res;

        if (cdnRegistry) {
            res = await fetch(`${ cdnRegistry }/${ moduleName.replace('@', '') }/${ CDN_REGISTRY_INFO_FILENAME }?cache-bust=${ Math.floor(Date.now() / CDN_REGISTRY_INFO_CACHEBUST_URL_TIME) }`);
            if (!res.ok) {
                logger.warn(`grabthar_cdn_registry_failure`, {
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
}, { lifetime: INFO_MEMORY_CACHE_LIFETIME });

type InstallOptions = {|
    logger : LoggerType,
    cache? : ?CacheType,
    dependencies? : boolean,
    registry : string,
    cdnRegistry : ?string,
    prefix : string,
    childModules : ?$ReadOnlyArray<string>
|};

export const installSingle = memoizePromise(async (moduleName : string, version : string, opts : InstallOptions) : Promise<void> => {

    if (!isValidDependencyVersion(version)) {
        throw new Error(`Invalid version for single install: ${ moduleName }@${ version }`);
    }

    const { cache, logger, registry = NPM_REGISTRY, cdnRegistry, prefix } = opts;

    const moduleInfo = await info(moduleName, { cache, logger, registry, cdnRegistry });

    const versionInfo = moduleInfo.versions[version];
    const tarball = versionInfo.dist.tarball;

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

    const tmpDir = join(tmpdir(), `grabthar-tmp-${ PACKAGE }-${ uuid.v4().slice(0, 8) }`);
    const packageDir = join(tmpDir, PACKAGE);
    const moduleDir = join(nodeModulesDir, moduleInfo.name);
    const modulePackageDir = join(moduleDir, PACKAGE_JSON);
    const moduleLock = join(moduleDir, LOCK);
    const moduleParentDir = join(moduleDir, '..');

    if (await exists(modulePackageDir)) {
        return;
    }

    if (existsSync(moduleLock)) {
        throw new Error(`${ moduleDir } is locked, can not install ${ moduleName }`);
    }

    await ensureDir(tmpDir);
    await ensureDir(prefix);
    await ensureDir(nodeModulesDir);
    await ensureDir(moduleParentDir);

    ensureFileSync(moduleLock);
    const lockTimer = setTimeout(() => {
        tryRemove(moduleLock);
    }, 60 * 1000);

    if (await exists(moduleDir)) {
        await rmrf(moduleDir);
    }

    try {
        await ensureDir(moduleDir);
        ensureFileSync(moduleLock);

        await download(tarball, tmpDir, { extract: true, filename: packageName });
        await move(packageDir, moduleDir, { overwrite: true });

        if (!await exists(modulePackageDir)) {
            throw new Error(`Package not found at ${ modulePackageDir }`);
        }
    } catch (err) {
        await rmrf(moduleDir);
        throw err;
    } finally {
        tryRemove(moduleLock);
        clearTimeout(lockTimer);
    }

    await tryRmrf(tmpDir);
});

export const install = async (moduleName : string, version : string, opts : InstallOptions) : Promise<void> => {
    return await useFileSystemLock(async () => {
        const { cache, logger, dependencies = false, registry = NPM_REGISTRY, cdnRegistry, childModules } = opts;

        const tasks = [];

        if (dependencies) {
            const moduleInfo = await info(moduleName, { cache, logger, registry, cdnRegistry });
            const dependencyVersions = moduleInfo.versions[version].dependencies;

            for (const dependencyName of Object.keys(dependencyVersions)) {
                const dependencyVersion = dependencyVersions[dependencyName];
                if (!isValidDependencyVersion(dependencyVersion)) {
                    throw new Error(`Invalid dependency version for flat single install: ${ dependencyName }@${ dependencyVersion }`);
                }
            }

            for (const dependencyName of Object.keys(dependencyVersions)) {
                if (childModules && childModules.indexOf(dependencyName) === -1) {
                    continue;
                }

                const dependencyVersion = dependencyVersions[dependencyName];
                tasks.push(installSingle(dependencyName, dependencyVersion, opts));
            }
        }

        tasks.push(installSingle(moduleName, version, opts));

        await Promise.all(tasks);
    });
};

export function clearCache() {
    cacheReadWrite.clear();
}
