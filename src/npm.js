/* @flow */
/* eslint const-immutable/no-mutation: off */

import { join } from 'path';

import compareVersions from 'compare-versions';
import { ensureDir, move, exists, readdir } from 'fs-extra';
import download from 'download';
import fetch from 'node-fetch';

import type { CacheType, LoggerType } from './types';
import { NPM_REGISTRY, CDN_REGISTRY_INFO_FILENAME, CDN_REGISTRY_INFO_CACHEBUST_URL_TIME, INFO_MEMORY_CACHE_LIFETIME, LIVE_MODULES_DIR_NAME } from './config';
import { NODE_MODULES, PACKAGE, PACKAGE_JSON, LOCK, DIST_TAGS, STABILITY } from './constants';
import { sanitizeString, cacheReadWrite, rmrf, withFileSystemLock, isValidDependencyVersion, memoizePromise, tryRmrf, getTemporaryDirectory, createHomeDirectory } from './util';

process.env.NO_UPDATE_NOTIFIER = 'true';

type Package = {|
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

type InfoResults = {|
    moduleInfo : Package,
    fetchedFromCDNRegistry : boolean
|};

export const info = memoizePromise(async (moduleName : string, opts : InfoOptions) : Promise<InfoResults> => {
    const { logger, cache, registry = NPM_REGISTRY, cdnRegistry } = opts;

    const sanitizedName = sanitizeString(moduleName);
    const sanitizedCDNRegistry = sanitizeString(cdnRegistry || 'npm');

    const cacheKey = `grabthar_npm_info_${ sanitizedName }_${ sanitizedCDNRegistry }`;

    const { name, versions, fetchedFromCDNRegistry, 'dist-tags': distTags } = await cacheReadWrite(cacheKey, async () => {
        let res;
        let isFromCDNRegistry = false;

        if (cdnRegistry) {
            res = await fetch(`${ cdnRegistry }/${ moduleName.replace('@', '') }/${ CDN_REGISTRY_INFO_FILENAME }?cache-bust=${ Math.floor(Date.now() / CDN_REGISTRY_INFO_CACHEBUST_URL_TIME) }`);
            if (res.ok) {
                isFromCDNRegistry = true;
            } else {
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

        const infoResults = extractInfo(await res.json());
        return { ...infoResults, fetchedFromCDNRegistry: isFromCDNRegistry };
    }, { logger, cache });

    return {
        moduleInfo: { name, versions, 'dist-tags': distTags },
        fetchedFromCDNRegistry
    };
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

    const { moduleInfo, fetchedFromCDNRegistry } = await info(moduleName, { cache, logger, registry, cdnRegistry });

    const versionInfo = moduleInfo.versions[version];

    if (!versionInfo) {
        throw new Error(`No version found for ${ moduleName } @ ${ version } - found ${ Object.keys(moduleInfo.versions).join(', ') }`);
    }

    if (!prefix) {
        throw new Error(`Prefix required for flat install`);
    }

    const initialTarball = versionInfo.dist.tarball;

    if (!initialTarball) {
        throw new Error(`Can not find tarball for ${ moduleInfo.name }`);
    }

    const nodeModulesDir = join(prefix, NODE_MODULES);
    const packageName = `${ PACKAGE }.tar.gz`;
    let tarball = initialTarball;

    if (cdnRegistry && fetchedFromCDNRegistry && !tarball.includes(cdnRegistry)) {
        try {
            const initialTarballPathname = new URL(tarball).pathname;
            const newTarballOrigin = new URL(cdnRegistry).origin;
            tarball = new URL(initialTarballPathname, newTarballOrigin).toString();

        } catch (err) {
            throw new Error(`Failed to parse tarball url ${ tarball }\n\n${ err.stack }`);
        }

        logger.info(`grabthar_npm_install_dependency_update_tarball_location`, { cdnRegistry, initialTarball, newTarball: tarball });
    }

    const tmpDir = await getTemporaryDirectory(moduleName);
    const packageDir = join(tmpDir, PACKAGE);
    const moduleDir = join(nodeModulesDir, moduleInfo.name);
    const modulePackageDir = join(moduleDir, PACKAGE_JSON);
    const moduleParentDir = join(moduleDir, '..');

    if (await exists(modulePackageDir)) {
        return;
    }

    await withFileSystemLock(async () => {
        await ensureDir(tmpDir);
        await ensureDir(prefix);
        await ensureDir(nodeModulesDir);
        await ensureDir(moduleParentDir);

        if (await exists(moduleDir)) {
            for (const file of await readdir(moduleDir)) {
                if (file === LOCK) {
                    continue;
                }
                await rmrf(join(moduleDir, file));
            }
        }

        await ensureDir(moduleDir);

        try {
            await download(tarball, tmpDir, { extract: true, filename: packageName });
            await move(packageDir, moduleDir, { overwrite: true });

            if (!await exists(modulePackageDir)) {
                throw new Error(`Package not found at ${ modulePackageDir }`);
            }
        } catch (err) {
            await rmrf(moduleDir);
            throw new Error(`Failed to download ${ tarball }\n\n${ err.stack }`);
        }

        await tryRmrf(tmpDir);
    }, moduleDir);
});

export function clearCache() {
    cacheReadWrite.clear();
}

type InstallVersionOptions = {|
    name : string,
    stability : Object,
    tag : string,
    dependencies? : boolean,
    logger : LoggerType,
    cache : ?CacheType,
    registry : string,
    cdnRegistry : ?string,
    childModules : ?$ReadOnlyArray<string>
|};

type InstallResult = {|
    version : string,
    previousVersion : string,
    nodeModulesPath : string,
    modulePath : string,
    dependencies : {
        [string] : {|
            version : string,
            path : string
        |}
    }
|};

function getMajorVersion(version : string) : string {
    return version.split('.')[0];
}

function cleanName(name : string) : string {
    return name.replace(/\//g, '-');
}

export async function installVersion({ name, stability, tag, dependencies = false, registry = NPM_REGISTRY, logger, cache, cdnRegistry, childModules } : InstallVersionOptions) : Promise<InstallResult> {
    const { moduleInfo } = await info(name, { logger, cache, registry, cdnRegistry });

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
    const cdnRegistryLabel = cdnRegistry ? new URL(cdnRegistry).hostname : '';
    const liveModulesDir = await createHomeDirectory(join(LIVE_MODULES_DIR_NAME, cdnRegistryLabel));
    const prefix = join(liveModulesDir, `${ cleanName(moduleInfo.name) }_${ version }`);
    const moduleName = moduleInfo.name;

    await withFileSystemLock(async () => {
        const sanitizedName = sanitizeString(moduleName);

        const tasks = [];

        if (dependencies) {
            const dependencyVersions = moduleInfo.versions[version].dependencies;


            logger.info(`grabthar_npm_install_dependencies_${ sanitizedName }`, { version, registry, dependencies: Object.keys(dependencyVersions).join(',') });

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
                tasks.push(installSingle(dependencyName, dependencyVersion, { prefix, cache, logger, dependencies, registry, cdnRegistry, childModules }));
            }
        }

        logger.info(`grabthar_npm_install_${ sanitizedName }`, { version, registry });
        tasks.push(installSingle(moduleName, version, { prefix, cache, logger, dependencies, registry, cdnRegistry, childModules }));

        try {
            await Promise.all(tasks);
        } catch (err) {
            logger.error(`grabthar_npm_install_${ sanitizedName }_error`, { err: err.stack || err.toString() });
            throw err;
        }
    });
    
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
        dependencies: moduleDependencies,
        version,
        previousVersion
    };
}
