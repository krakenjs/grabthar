/* @flow */

import { join } from 'path';

import { mkdir, exists, move } from 'fs-extra';
import compareVersions from 'compare-versions';
import download from 'download';
import fetch from 'node-fetch';

import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT, NPM_INFO_TIMEOUT } from './config';
import { DIST_TAGS, NPM, DIST_TAG, NODE_MODULES, PACKAGE } from './constants';
import { memoize, memoizePromise, npmRun, stringifyCommandLineOptions, lookupDNS } from './util';

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

type Dependencies = { [string] : string };

type Package = {
    'version' : string,
    'dependencies' : Dependencies,
    'versions' : Array<string>,
    'dist-tags' : {
        release? : string,
        latest? : string
    },
    'dist' : {
        tarball : string
    }
};

async function fetchInfo(name : string, registry? : string = NPM_REGISTRY, version? : string) : Promise<Package> {
    const res = await fetch(`${ registry }/${ name }`);

    if (res.status !== 200) {
        throw new Error(`npm returned status ${ res.status || 'unknown' } for ${ registry }/${ name }`);
    }

    const result = await res.json();

    const distTags = result['dist-tags'];
    version = version || distTags.latest;
    const info = result.versions && result.versions[version];
    const dependencies = info && info.dependencies;
    const versions = Object.keys(result.versions || {});
    const dist = info && info.dist;

    if (!distTags || !version || !info || !dependencies || !versions || !dist) {
        throw new Error(`Missing info from fetched npm details`);
    }

    return {
        version,
        dependencies,
        versions,
        dist,
        'dist-tags': distTags
    };
}

export let info = memoizePromise(async (name : string, npmOptions : ?NpmOptionsType = {}, version? : string) : Promise<Package> => {
    try {
        if (process.env.NODE_ENV !== 'test') {
            return await fetchInfo(name, npmOptions ? npmOptions.registry : NPM_REGISTRY, version);
        }
    } catch (err) {
        // pass
    }

    return await npm('info', [ version ? `${ name }@${ version }` : name ], npmOptions, NPM_INFO_TIMEOUT);
});

export let getModuleDependencies = memoize(async (name : string, version : string, npmOptions : ?NpmOptionsType = {}) : { [string] : string } => {
    let pkg = await info(name, npmOptions, version);
    if (!pkg.dependencies) {
        throw new Error(`Could not get dependencies for ${ name }`);
    }
    return pkg.dependencies;
});

export let getRemotePackageDistTagVersion = memoizePromise(async (moduleName : string, tag : string, npmOptions : ?NpmOptionsType = {}) : Promise<string> => {
    let pkg = await info(moduleName, npmOptions);
    let version = pkg[DIST_TAGS] && pkg[DIST_TAGS][tag];
    if (!version) {
        if (tag === DIST_TAG.LATEST && pkg.version) {
            return pkg.version;
        }

        throw new Error(`Can not determine ${ tag } version of ${ moduleName } from\n\n${ JSON.stringify(pkg, null, 4) }`);
    }
    return version;
});

export let getRemoteModuleVersions = memoizePromise(async (moduleName : string, npmOptions : ?NpmOptionsType = {}) : Promise<Array<string>> => {
    let pkg = await info(moduleName, npmOptions);
    if (!pkg.versions) {
        throw new Error(`Could not get versions for ${ moduleName }`);
    }
    return pkg.versions
        .filter(ver => ver.match(/^\d+\.\d+\.\d+$/))
        .sort(compareVersions)
        .reverse();
});

export let installFlat = memoize(async (name : string, version : string, npmOptions? : NpmOptionsType = {}) : Promise<void> => {
    let pkg = await info(name, npmOptions);
    let tarball = pkg.dist && pkg.dist.tarball;
    let prefix = npmOptions.prefix;

    if (!prefix) {
        throw new Error(`Prefix required for flat install`);
    }

    if (!tarball) {
        throw new Error(`Can not find tarball for ${ name }`);
    }

    let nodeModulesDir = join(prefix, NODE_MODULES);
    let packageName = `${ PACKAGE }.tar.gz`;
    let packageDir = join(nodeModulesDir, PACKAGE);
    let moduleDir = join(nodeModulesDir, name);

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
