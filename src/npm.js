/* @flow */
/* eslint const-immutable/no-mutation: off */

import { join } from 'path';

import { mkdir, exists, move } from 'fs-extra';
import download from 'download';
import fetch from 'node-fetch';

import type { CacheType, LoggerType } from './types';
import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT } from './config';
import { NPM, NODE_MODULES, PACKAGE } from './constants';
import { npmRun, sanitizeString,
    stringifyCommandLineOptions, lookupDNS, cacheReadWrite, clearObject } from './util';

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
    npmOptions : NpmOptionsType,
    cache : ?CacheType,
    logger : LoggerType
|};

const infoCache : { [string] : Promise<Package> } = {};

export async function info(moduleName : string, { npmOptions = getDefaultNpmOptions(), logger, cache } : InfoOptions) : Promise<Package> {
    const memoryCacheKey = JSON.stringify({ moduleName, npmOptions });
    const { registry = NPM_REGISTRY } = npmOptions;

    infoCache[memoryCacheKey] = infoCache[memoryCacheKey] || (async () => {
        const sanitizedName = sanitizeString(moduleName);
        const cacheKey = `grabthar_npm_info_${ sanitizedName }`;
        logger.info(`grabthar_npm_info_${ sanitizedName }`, { registry });

        const { name, versions, 'dist-tags': distTags } = await cacheReadWrite(cacheKey, async () => {
            const res = await fetch(`${ registry }/${ moduleName }`);

            if (res.status !== 200) {
                throw new Error(`npm returned status ${ res.status || 'unknown' } for ${ registry }/${ moduleName }`);
            }

            return extractInfo(await res.json());

        }, { logger, cache });

        return { name, versions, 'dist-tags': distTags };
    })();

    return await infoCache[memoryCacheKey];
}

type InstallOptions = {|
    npmOptions? : NpmOptionsType,
    logger : LoggerType
|};

const installFlatCache : { [string] : Promise<void> } = {};

export const installFlat = async (moduleInfo : Package, version : string, { npmOptions = getDefaultNpmOptions(), logger } : InstallOptions) : Promise<void> => {
    const installFlatMemoryCacheKey = JSON.stringify({ moduleInfo, version, npmOptions });

    installFlatCache[installFlatMemoryCacheKey] = installFlatCache[installFlatMemoryCacheKey] || (async () => {
        const { name: moduleName } = moduleInfo;
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
        logger.info(`grabthar_npm_install_flat_${ sanitizedName }`, { registry });

        const nodeModulesDir = join(prefix, NODE_MODULES);
        const packageName = `${ PACKAGE }.tar.gz`;
        const packageDir = join(nodeModulesDir, PACKAGE);
        const moduleDir = join(nodeModulesDir, moduleInfo.name);

        if (await exists(moduleDir)) {
            return;
        }

        if (!await exists(nodeModulesDir)) {
            await mkdir(nodeModulesDir);
        }

        await download(tarball, nodeModulesDir, { extract: true, filename: packageName });
        await move(packageDir, moduleDir);
    })();

    return await installFlatCache[installFlatMemoryCacheKey];
};

const installCache : { [string] : Promise<void> } = {};

export const install = async (moduleInfo : Package, version : string, { npmOptions = getDefaultNpmOptions(), logger } : InstallOptions) : Promise<void> => {
    const installMemoryCacheKey = JSON.stringify({ moduleInfo, version, npmOptions });

    installCache[installMemoryCacheKey] = installCache[installMemoryCacheKey] || (async () => {
        const { name: moduleName } = moduleInfo;
        const { registry } = npmOptions;
        const sanitizedName = sanitizeString(moduleName);
        logger.info(`grabthar_npm_install_${ sanitizedName }`, { registry });
        await npm('install', [ `${ moduleName }@${ version }` ], npmOptions);
    })();

    return await installCache[installMemoryCacheKey];
};

export function clearCache() {
    clearObject(verifyCache);
    clearObject(infoCache);
    clearObject(installFlatCache);
    clearObject(installCache);
}
