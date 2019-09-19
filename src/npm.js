/* @flow */
/* eslint const-immutable/no-mutation: off */

import { join } from 'path';

import { mkdir, exists, move } from 'fs-extra';
import download from 'download';
import fetch from 'node-fetch';

import type { CacheType, LoggerType } from './types';
import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT } from './config';
import { NPM, NODE_MODULES, PACKAGE } from './constants';
import { memoize, memoizePromise, inlineMemoizePromise, npmRun, stringifyCommandLineOptions, lookupDNS, cacheReadWrite } from './util';

process.env.NO_UPDATE_NOTIFIER = 'true';

export type NpmOptionsType = {
    prefix? : string,
    registry? : string
};

const DEFAULT_NPM_OPTIONS : NpmOptionsType = {
    silent:     true,
    json:       true,
    production: true,
    cache:      NPM_CACHE_DIR,
    registry:   NPM_REGISTRY
};

const verifyRegistry = memoizePromise(async (domain : string) : Promise<void> => {
    await lookupDNS(domain);
    const res = await fetch(`${ domain }/info`);
    if (res.status !== 200) {
        throw new Error(`Got ${ res.status } from ${ domain }/info`);
    }
});


export async function npm(command : string, args : Array<string> = [], npmOptions : ?NpmOptionsType = {}, timeout? : number = NPM_TIMEOUT) : Promise<Object> {
    npmOptions = Object.assign({}, DEFAULT_NPM_OPTIONS, npmOptions);

    if (!npmOptions.registry) {
        throw new Error(`Expected npm registry to be passed`);
    }

    await verifyRegistry(npmOptions.registry);

    let cmdstring = `${ NPM } ${ command } ${ args.join(' ') } ${ stringifyCommandLineOptions(npmOptions) }`;

    let cmdoptions : NpmOptionsType = {
        timeout,
        env: process.env
    };
    
    let result = await npmRun(cmdstring, cmdoptions);

    return JSON.parse(result);
}

export type Package = {|
    'name' : string,
    'versions' : {
        [string] : {|
            'dependencies' : {
                [ string ] : string
            },
            'dist' : {
                'tarball' : string
            }
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

export async function info (moduleName : string, { registry = NPM_REGISTRY, logger, cache } : { registry? : string, cache : ?CacheType, logger : LoggerType }) : Promise<Package> {
    return await inlineMemoizePromise(info, moduleName, async () => {

        const sanitizedName = moduleName.replace(/[^a-zA-Z0-9]+/g, '_');
        const cacheKey = `grabthar_npm_info_${ sanitizedName }`;

        logger.info(`grabthar_info_${ sanitizedName }`, { registry });

        const { name, versions, 'dist-tags': distTags } = await cacheReadWrite(cacheKey, async () => {
            const res = await fetch(`${ registry }/${ moduleName }`);
    
            if (res.status !== 200) {
                throw new Error(`npm returned status ${ res.status || 'unknown' } for ${ registry }/${ moduleName }`);
            }
        
            return extractInfo(await res.json());

        }, { logger, cache });

        return { name, versions, 'dist-tags': distTags };
    });
}

export let installFlat = memoize(async (moduleInfo : Package, version : string, npmOptions? : NpmOptionsType = {}) : Promise<void> => {
    let versionInfo = moduleInfo.versions[version];
    let tarball = versionInfo.dist.tarball;
    let prefix = npmOptions.prefix;

    if (!prefix) {
        throw new Error(`Prefix required for flat install`);
    }

    if (!tarball) {
        throw new Error(`Can not find tarball for ${ moduleInfo.name }`);
    }

    let nodeModulesDir = join(prefix, NODE_MODULES);
    let packageName = `${ PACKAGE }.tar.gz`;
    let packageDir = join(nodeModulesDir, PACKAGE);
    let moduleDir = join(nodeModulesDir, moduleInfo.name);

    if (await exists(moduleDir)) {
        return;
    }

    if (!await exists(nodeModulesDir)) {
        await mkdir(nodeModulesDir);
    }
    
    await download(tarball, nodeModulesDir, { extract: true, filename: packageName });

    await move(packageDir, moduleDir);
});


export let install = memoize(async (name : string, version : string, npmOptions : ?NpmOptionsType = {}) : Promise<void> => {
    await npm('install', [ `${ name }@${ version }` ], npmOptions);
});
