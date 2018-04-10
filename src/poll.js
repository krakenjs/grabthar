/* @flow */

import { join } from 'path';

import { install, getRemotePackageDistTagVersion, getModuleDependencies } from './npm';
import { poll, createHomeDirectory, type Poller, memoize } from './util';
import { MODULE_ROOT_NAME } from './config';
import { DIST_TAG, NODE_MODULES } from './constants';

type PollModuleDetails = {
    root : string,
    path : string,
    version : string,
    dependencies : { [string] : string }
};

function pollInstallDistTag({ name, onError, tag, period = 20 } : { name : string, tag : string, onError : (Error) => void, period? : number }) : Poller<PollModuleDetails> {
    
    let root;
    let path;
    let version;
    let dependencies;

    return poll({
        handler: async () => {
            let newVersion = await getRemotePackageDistTagVersion(name, tag);

            if (!version || version !== newVersion) {
                let newRoot = await createHomeDirectory(MODULE_ROOT_NAME, `${ name }_${ newVersion }`);

                let installPromise = install(name, newVersion, newRoot);
                let dependenciesPromise = getModuleDependencies(name, newVersion);

                await installPromise;

                root = newRoot;
                path = join(root, NODE_MODULES, name);
                version = newVersion;
                dependencies = await dependenciesPromise;
            }

            return { root, path, version, dependencies };
        },
        period: period * 1000,
        onError
    }).start();
}

export type ModuleDetails = {
    root : string,
    path : string,
    version : string,
    dependencies : { [string] : string }
};

type NpmWatcher = {
    get : (tag? : string) => Promise<ModuleDetails>,
    import : <T: Object>() => Promise<T>,
    cancel : () => void
};

type NPMPollOptions = {
    name : string,
    tags? : Array<string>,
    onError : (Error) => void,
    period? : number
};

export function npmPoll({ name, tags = [ DIST_TAG.LATEST ], onError, period = 20 } : NPMPollOptions) : NpmWatcher {

    let pollers = {};

    for (let tag of tags) {
        pollers[tag] = pollInstallDistTag({ name, tag, onError, period });
    }

    async function pollerGet(tag? : string) : Promise<ModuleDetails> {
        if (tag && !pollers[tag]) {
            throw new Error(`Invalid tag: ${ tag }`);
        }

        if (!tag) {
            if (tags.length === 1) {
                tag = tags[0];
            } else if (pollers[DIST_TAG.LATEST]) {
                tag = DIST_TAG.LATEST;
            } else {
                throw new Error(`Please specify tag: one of ${ tags.join(', ') }`);
            }
        }

        return await pollers[tag || DIST_TAG.LATEST].result();
    }

    async function pollerImport <T : Object>() : T {
        let { path } = await pollerGet();
        // $FlowFixMe
        return require(path); // eslint-disable-line security/detect-non-literal-require
    }

    function pollerCancel() {
        for (let tag of tags) {
            pollers[tag].stop();
        }
    }

    return {
        get:    pollerGet,
        import: pollerImport,
        cancel: pollerCancel
    };
}

npmPoll.flushCache = () => {
    memoize.clear();
};
