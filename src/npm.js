/* @flow */

import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT } from './config';
import { DIST_TAGS, NPM, DIST_TAG } from './constants';
import { memoize, memoizePromise, npmRun } from './util';

process.env.NO_UPDATE_NOTIFIER = 'true';

const DEFAULT_NPM_OPTIONS = [
    `--silent`,
    `--json`,
    `--production`,
    `--cache="${ NPM_CACHE_DIR }"`,
    `--registry="${ NPM_REGISTRY }"`
].join(' ');

export async function npm(command : string, args : Array<string> = []) : Promise<Object> {
    let cmdstring = `${ NPM } ${ command } ${ args.join(' ') } ${ DEFAULT_NPM_OPTIONS }`;
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
    'dist-tags' : {
        release? : string,
        latest? : string
    }
};

export let getRemotePackage = memoizePromise(async (name : string) : Promise<Package> => {
    return await npm('info', [ name ]);
});

export async function getModuleDependencies(name : string, version : string) : { [string] : string } {
    let pkg = await getRemotePackage(`${ name }@${ version }`);
    if (!pkg.dependencies) {
        throw new Error(`Could not get dependencies for ${ name }`);
    }
    return pkg.dependencies;
}

export let getRemotePackageDistTagVersion = memoizePromise(async (moduleName : string, tag : string) : Promise<string> => {
    let pkg = await getRemotePackage(moduleName);
    let version = pkg[DIST_TAGS] && pkg[DIST_TAGS][tag];
    if (!version) {
        if (tag === DIST_TAG.LATEST && pkg.version) {
            return pkg.version;
        }

        throw new Error(`Can not determine ${ tag } version of ${ moduleName } from\n\n${ JSON.stringify(pkg, null, 4) }`);
    }
    return version;
});

export let install = memoize(async (name : string, version : string, dir : string) : Promise<Object> => {
    return await npm('install', [ `${ name }@${ version }`, '--prefix', dir ]);
});
