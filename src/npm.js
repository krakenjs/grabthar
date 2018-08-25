/* @flow */

import compareVersions from 'compare-versions';

import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT } from './config';
import { DIST_TAGS, NPM, DIST_TAG } from './constants';
import { memoize, memoizePromise, npmRun, stringifyCommandLineOptions } from './util';

process.env.NO_UPDATE_NOTIFIER = 'true';

export type NpmOptionsType = {
    [string] : string | boolean
};

const DEFAULT_NPM_OPTIONS = {
    silent:     true,
    json:       true,
    production: true,
    cache:      NPM_CACHE_DIR,
    registry:   NPM_REGISTRY
};

export async function npm(command : string, args : Array<string> = [], npmOptions : ?NpmOptionsType = {}) : Promise<Object> {
    npmOptions = Object.assign({}, DEFAULT_NPM_OPTIONS, npmOptions);
    let cmdstring = `${ NPM } ${ command } ${ args.join(' ') } ${ stringifyCommandLineOptions(npmOptions) }`;
    let cmdoptions = {
        timeout: NPM_TIMEOUT,
        env:     process.env
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
    }
};

export let getRemotePackage = memoizePromise(async (name : string, npmOptions : ?NpmOptionsType = {}) : Promise<Package> => {
    return await npm('info', [ name ], npmOptions);
});

export let getModuleDependencies = memoize(async (name : string, version : string, npmOptions : ?NpmOptionsType = {}) : { [string] : string } => {
    let pkg = await getRemotePackage(`${ name }@${ version }`, npmOptions);
    if (!pkg.dependencies) {
        throw new Error(`Could not get dependencies for ${ name }`);
    }
    return pkg.dependencies;
});

export let getRemotePackageDistTagVersion = memoizePromise(async (moduleName : string, tag : string, npmOptions : ?NpmOptionsType = {}) : Promise<string> => {
    let pkg = await getRemotePackage(moduleName, npmOptions);
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
    let pkg = await getRemotePackage(moduleName, npmOptions);
    if (!pkg.versions) {
        throw new Error(`Could not get versions for ${ moduleName }`);
    }
    return pkg.versions
        .filter(ver => ver.match(/^\d+\.\d+\.\d+$/))
        .sort(compareVersions)
        .reverse();
});


export let install = memoize(async (name : string, version : string, npmOptions : ?NpmOptionsType = {}) : Promise<Object> => {
    return await npm('install', [ `${ name }@${ version }` ], npmOptions);
});
