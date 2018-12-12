/* @flow */

import { join } from 'path';

import compareVersions from 'compare-versions';

import { install, installFlat, getRemotePackageDistTagVersion, getModuleDependencies, getRemoteModuleVersions, type NpmOptionsType } from './npm';
import { poll, createHomeDirectory, memoize } from './util';
import { MODULE_ROOT_NAME } from './config';
import { DIST_TAG, NODE_MODULES, STABILITY } from './constants';

type ModuleDetails = {
    rootPath : string,
    nodeModulesPath : string,
    modulePath : string,
    version : string,
    dependencies : {
        [string] : {
            version : string,
            path : string
        }
    }
};

async function installVersion({ name, version, flat = false, npmOptions = {} } : { name : string, version : string, flat? : boolean, npmOptions : NpmOptionsType }) : Promise<ModuleDetails> {
    let newRoot = await createHomeDirectory(MODULE_ROOT_NAME, `${ name.replace(/\//g, '-') }_${ version }`);

    let installPromise = flat
        ? installFlat(name, version, { ...npmOptions, prefix: newRoot })
        : install(name, version, { ...npmOptions, prefix: newRoot });

    let dependenciesPromise = getModuleDependencies(name, version, npmOptions);

    await installPromise;

    let rootPath = newRoot;
    let nodeModulesPath = join(rootPath, NODE_MODULES);
    let modulePath = join(nodeModulesPath, name);
    let dependencyVersions = await dependenciesPromise;
    let dependencies = {};
    for (let dependencyName of Object.keys(dependencyVersions)) {
        dependencies[dependencyName] = {
            version: dependencyVersions[dependencyName],
            path:    join(nodeModulesPath, dependencyName)
        };
    }

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

function pollInstallDistTag({ name, onError, tag, period = 20, flat = false, npmOptions = {} } :
    { name : string, tag : string, onError : (Error) => void, period? : number, flat? : boolean, npmOptions : NpmOptionsType }) : DistPoller<ModuleDetails> {
    
    let stability : { [string] : string } = {};

    let poller = poll({
        handler: async () => {
            let [ distTagVersion, allVersions ] = await Promise.all([
                getRemotePackageDistTagVersion(name, tag, npmOptions),
                getRemoteModuleVersions(name, npmOptions)
            ]);

            stability[distTagVersion] = stability[distTagVersion] || STABILITY.STABLE;
            let majorVersion = getMajorVersion(distTagVersion);

            let eligibleVersions = allVersions.filter(ver => {

                // Do not allow versions that are not the major version of the dist-tag
                if (getMajorVersion(ver) !== majorVersion) {
                    return false;
                }

                // Do not allow versions ahead of the current dist-tag
                if (compareVersions(ver, distTagVersion) === 1) {
                    return false;
                }

                // Do not allow versions marked as unstable
                if (stability[ver] === STABILITY.UNSTABLE) {
                    return false;
                }

                return true;
            });

            if (!eligibleVersions.length) {
                throw new Error(`No eligible versions found for module ${ name } -- from [ ${ allVersions.join(', ') } ]`);
            }


            let stableVersions = eligibleVersions.filter(ver => {

                if (stability[ver] !== STABILITY.STABLE) {
                    return false;
                }

                return true;
            });

            let previousVersion = stableVersions.length ? stableVersions[0] : eligibleVersions[0];

            if (stability[distTagVersion] === STABILITY.UNSTABLE) {
                distTagVersion = previousVersion;
            }

            let moduleDetails = await installVersion({ name, version: distTagVersion, flat, npmOptions });
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

type NpmWatcher<T : Object> = {
    get : (tag? : string) => Promise<ModuleDetails>,
    import : (?string) => Promise<T>,
    cancel : () => void,
    markStable : (string) => void,
    markUnstable : (string) => void
};

type NPMPollOptions = {
    name : string,
    tags? : Array<string>,
    onError : (Error) => void,
    period? : number,
    npmOptions? : NpmOptionsType,
    flat? : boolean
};

export function npmPoll({ name, tags = [ DIST_TAG.LATEST ], onError, period = 20, flat = false, npmOptions = {} } : NPMPollOptions) : NpmWatcher<Object> {

    let pollers = {};

    for (let tag of tags) {
        pollers[tag] = pollInstallDistTag({ name, tag, onError, period, flat, npmOptions });
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

    async function pollerImport <T : Object>(path = '') : T {
        let { modulePath } = await pollerGet();
        // $FlowFixMe
        return require(join(modulePath, path)); // eslint-disable-line security/detect-non-literal-require
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
