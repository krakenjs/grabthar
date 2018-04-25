/* @flow */

import { join } from 'path';

import compareVersions from 'compare-versions';

import { install, getRemotePackageDistTagVersion, getModuleDependencies, getRemoteModuleVersions } from './npm';
import { poll, createHomeDirectory, memoize } from './util';
import { MODULE_ROOT_NAME } from './config';
import { DIST_TAG, NODE_MODULES, STABILITY } from './constants';

type ModuleDetails = {
    rootPath : string,
    nodeModulesPath : string,
    modulePath : string,
    version : string,
    dependencies : { [string] : string }
};

async function installVersion({ name, version }) : Promise<ModuleDetails> {
    let newRoot = await createHomeDirectory(MODULE_ROOT_NAME, `${ name }_${ version }`);

    let installPromise = install(name, version, newRoot);
    let dependenciesPromise = getModuleDependencies(name, version);

    await installPromise;

    let rootPath = newRoot;
    let nodeModulesPath = join(rootPath, NODE_MODULES);
    let modulePath = join(nodeModulesPath, name);
    let dependencies = await dependenciesPromise;

    return { rootPath, nodeModulesPath, modulePath, version, dependencies };
}

type DistPoller<T> = {
    result : () => Promise<T>,
    stop : () => void,
    markStable : (string) => void,
    markUnstable : (string) => void
};

function getMajorVersion(version : string) : string {
    return version.split('.')[0];
}

function pollInstallDistTag({ name, onError, tag, period = 20 } : { name : string, tag : string, onError : (Error) => void, period? : number }) : DistPoller<ModuleDetails> {
    
    let stability : { [string] : string } = {};

    let poller = poll({
        handler: async () => {
            let [ version, allVersions ] = await Promise.all([
                getRemotePackageDistTagVersion(name, tag),
                getRemoteModuleVersions(name)
            ]);

            stability[version] = stability[version] || STABILITY.STABLE;
            let majorVersion = getMajorVersion(version);

            let eligibleVersions = allVersions.filter(ver => {

                if (getMajorVersion(ver) !== majorVersion) {
                    return false;
                }

                if (compareVersions(version, ver) !== -1) {
                    return false;
                }

                if (stability[ver] === STABILITY.UNSTABLE) {
                    return false;
                }

                return true;
            });

            let stableVersions = eligibleVersions.filter(ver => {

                if (stability[ver] !== STABILITY.STABLE) {
                    return false;
                }

                return true;
            });

            if (!eligibleVersions.length) {
                throw new Error(`No eligible versions found for module ${ name }`);
            }

            let previousVersion = stableVersions.length ? stableVersions[0] : eligibleVersions[0];

            if (stability[version] === STABILITY.UNSTABLE) {
                version = previousVersion;
            }

            let moduleDetails = await installVersion({ name, version });
            return { ...moduleDetails, previousVersion };
        },
        period: period * 1000,
        onError
    }).start();

    return {
        stop:       () => { poller.stop(); },
        result:     async () => await poller.result(),
        markStable: (version : string) => {
            stability[version] = STABILITY.STABLE;
        },
        markUnstable: (version : string) => {
            stability[version] = STABILITY.UNSTABLE;
        }
    };
}

type NpmWatcher = {
    get : (tag? : string) => Promise<ModuleDetails>,
    import : <T: Object>() => Promise<T>,
    cancel : () => void,
    markStable : (string) => void,
    markUnstable : (string) => void
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
        let { modulePath } = await pollerGet();
        // $FlowFixMe
        return require(modulePath); // eslint-disable-line security/detect-non-literal-require
    }

    function pollerCancel() {
        for (let tag of tags) {
            pollers[tag].stop();
        }
    }

    function pollerMarkStable(version : string) {
        for (let tag of tags) {
            pollers[tag].markStable(version);
        }
    }

    function pollerMarkUnstable(version : string) {
        for (let tag of tags) {
            pollers[tag].markUnstable(version);
        }
    }

    return {
        get:          pollerGet,
        import:       pollerImport,
        cancel:       pollerCancel,
        markStable:   pollerMarkStable,
        markUnstable: pollerMarkUnstable
    };
}

npmPoll.flushCache = () => {
    memoize.clear();
};
