/* @flow */

import { NPM_REGISTRY, NPM_CACHE_DIR, NPM_TIMEOUT } from './config';
import { DIST_TAGS, NPM } from './constants';
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

export let getRemotePackage = memoizePromise(async (moduleName : string) : Promise<Package> => {
    return await npm('info', [ moduleName ]);
});

export async function getModuleDependencies(moduleName : string, moduleVersion : string) : { [string] : string } {
    let pkg = await getRemotePackage(`${ moduleName }@${ moduleVersion }`);
    if (!pkg.dependencies) {
        throw new Error(`Could not get dependencies for ${ moduleName }`);
    }
    return pkg.dependencies;
}

export let getRemotePackageDistTagVersion = memoizePromise(async (moduleName : string, distTag : string) : Promise<string> => {
    let pkg = await getRemotePackage(moduleName);
    let latest = pkg[DIST_TAGS] && pkg[DIST_TAGS][distTag];
    let version = latest || pkg.version;
    if (!version) {
        throw new Error(`Can not determine ${ distTag } version of ${ moduleName } from\n\n${ JSON.stringify(pkg, null, 4) }`);
    }
    return version;
});

export let install = memoize(async (moduleName : string, version : string, dir : string) : Promise<Object> => {
    return await npm('install', [ `${ moduleName }@${ version }`, '--prefix', dir ]);
});
