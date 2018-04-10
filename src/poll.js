/* @flow */

import { install, getRemotePackageDistTagVersion, getModuleDependencies } from './npm';
import { poll, createHomeDirectory, type Poller, memoize } from './util';
import { MODULE_ROOT_NAME } from './config';
import { DIST_TAG } from './constants';

export type ModuleDetails = {
    moduleRoot : string,
    moduleVersion : string
};

function pollInstallDistTag({ moduleName, onError, distTag, period = 20 } : { moduleName : string, distTag : string, onError : (Error) => void, period? : number }) : Poller<ModuleDetails> {
    let moduleRoot;
    let moduleVersion;

    return poll({
        handler: async () => {
            let newVersion = await getRemotePackageDistTagVersion(moduleName, distTag);

            if (!moduleVersion || moduleVersion !== newVersion) {
                let newModuleRoot = await createHomeDirectory(MODULE_ROOT_NAME, `${ moduleName }_${ newVersion }`);
                await install(moduleName, newVersion, newModuleRoot);

                moduleVersion = newVersion;
                moduleRoot = newModuleRoot;
            }

            return { moduleRoot, moduleVersion };
        },
        period: period * 1000,
        onError
    }).start();
}

type NpmWatcher = {
    getReleaseModule : () => Promise<ModuleDetails>,
    getLatestModule : () => Promise<ModuleDetails>,
    getReleaseModuleDependencies : () => Promise<{ [string] : string }>,
    getLatestModuleDependencies : () => Promise<{ [string] : string }>,
    cancel : () => void
};

export function npmPoll({ moduleName, onError, period = 20 } : { moduleName : string, onError : (Error) => void, period? : number }) : NpmWatcher {

    let releasePoller = pollInstallDistTag({ moduleName, distTag: DIST_TAG.RELEASE, onError, period });
    let latestPoller  = pollInstallDistTag({ moduleName, distTag: DIST_TAG.LATEST, onError, period });

    return {
        getReleaseModule: async () => {
            return await releasePoller.result();
        },
        getLatestModule: async () => {
            return await latestPoller.result();
        },
        getReleaseModuleDependencies: async () => {
            let { moduleVersion } = await releasePoller.result();
            return await getModuleDependencies(moduleName, moduleVersion);
        },
        getLatestModuleDependencies: async () => {
            let { moduleVersion } = await latestPoller.result();
            return await getModuleDependencies(moduleName, moduleVersion);
        },
        cancel: () => {
            releasePoller.stop();
            latestPoller.stop();
        }
    };
}

npmPoll.flushCache = () => {
    memoize.clear();
};
