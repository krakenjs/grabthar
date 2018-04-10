/* @flow */

import { install, getRemotePackageDistTagVersion, getModuleDependencies } from './npm';
import { poll, createHomeDirectory, type Poller, memoize } from './util';
import { MODULE_ROOT_NAME } from './config';
import { DIST_TAG } from './constants';

type PollModuleDetails = {
    root : string,
    version : string
};

function pollInstallDistTag({ name, onError, tag, period = 20 } : { name : string, tag : string, onError : (Error) => void, period? : number }) : Poller<PollModuleDetails> {
    let root;
    let version;

    return poll({
        handler: async () => {
            let newVersion = await getRemotePackageDistTagVersion(name, tag);

            if (!version || version !== newVersion) {
                let newRoot = await createHomeDirectory(MODULE_ROOT_NAME, `${ name }_${ newVersion }`);
                await install(name, newVersion, newRoot);

                version = newVersion;
                root = newRoot;
            }

            return { root, version };
        },
        period: period * 1000,
        onError
    }).start();
}

export type ModuleDetails = {
    root : string,
    version : string,
    dependencies : { [string] : string }
};

type NpmWatcher = {
    get : (tag? : string) => Promise<ModuleDetails>,
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

    return {
        get: async (tag? : string) => {

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

            let { root, version } = await pollers[tag || DIST_TAG.LATEST].result();
            let dependencies = await getModuleDependencies(name, version);
            return { root, version, dependencies };
        },
        cancel: () => {
            for (let tag of tags) {
                pollers[tag].stop();
            }
        }
    };
}

npmPoll.flushCache = () => {
    memoize.clear();
};
