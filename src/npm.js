/* @flow */
/* eslint const-immutable/no-mutation: off */

import { join } from 'path';

import { mkdir, exists, move } from 'fs-extra';
import download from 'download';
import fetch from 'node-fetch';
import { memoize } from 'belter';

import type { CacheType, LoggerType } from './types';
import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT } from './config';
import { NPM, NODE_MODULES, PACKAGE } from './constants';
import { memoizePromise, inlineMemoizePromise, npmRun, stringifyCommandLineOptions, lookupDNS, cacheReadWrite } from './util';

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

const verifyRegistry = memoizePromise(async (domain : string) : Promise<void> => {
    await lookupDNS(domain);
    const res = await fetch(`${ domain }/info`);
    if (res.status !== 200) {
        throw new Error(`Got ${ res.status } from ${ domain }/info`);
    }
});


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

export async function info (moduleName : string, { registry = NPM_REGISTRY, logger, cache } : {| registry? : string, cache : ?CacheType, logger : LoggerType |}) : Promise<Package> {
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

export const installFlat = memoize(async (moduleInfo : Package, version : string, npmOptions? : NpmOptionsType = getDefaultNpmOptions()) : Promise<void> => {
    const versionInfo = moduleInfo.versions[version];
    const tarball = versionInfo.dist.tarball;
    const prefix = npmOptions.prefix;

    if (!prefix) {
        throw new Error(`Prefix required for flat install`);
    }

    if (!tarball) {
        throw new Error(`Can not find tarball for ${ moduleInfo.name }`);
    }

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
});


export const install = memoize(async (name : string, version : string, npmOptions : ?NpmOptionsType = getDefaultNpmOptions()) : Promise<void> => {
    await npm('install', [ `${ name }@${ version }` ], npmOptions);
});
