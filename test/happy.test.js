/* @flow */
/* eslint import/order: 0, max-lines: 0 */

import { homedir } from 'os';
import { join } from 'path';

import nock from 'nock';
import { test, expect, jest, describe, afterEach } from '@jest/globals';
import { exists } from 'fs-extra';
import rmfr from 'rmfr';

import { poll } from '../src';

export function entries<T>(obj : { [string] : T }) : $ReadOnlyArray<[ string, T ]> {
    // $FlowFixMe
    return Object.entries(obj);
}

const logger = {
    debug: () => {
        // pass
    },
    info:  () => {
        // pass
    },
    warn:  () => {
        // pass
    },
    error: (...args) => {
        // eslint-disable-next-line no-console
        console.error(...args);
    }
};

const MODULE_NAME = 'grabthar-test-module';
const MODULE_VERSION = '1.3.53';

const __LIVE_MODULES__ = '__live_modules__';
const NODE_MODULES = 'node_modules';

describe('happy path tests', () => {
    afterEach(async () => {
        poll.flushCache();
        nock.cleanAll();
        await rmfr(join(homedir(), __LIVE_MODULES__));
    });

    test(`Should poll for a module and install it, then return the correct latest version`, async () => {
        const REGISTRY = 'https://registry.npmjs.org';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':        MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info)
            .persist();

        const tarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:   onErrorCallback,
            logger
        });

        const result = await poller.get();

        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
        }

        infoReq.done();
        tarballReq.done();
    });

    test(`Should poll for a module on a custom registry and install it, then return the correct latest version`, async () => {
        const REGISTRY = 'https://npm.paypal.com';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':        MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info)
            .persist();

        const tarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:   onErrorCallback,
            registry:     REGISTRY,
            logger
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
        }

        infoReq.done();
        tarballReq.done();
    });

    test(`Should poll for a module on a cdn registry and install it, then return the correct latest version`, async () => {
        const CDN_PATH = 'foo';
        const CDN_REGISTRY = `https://www.paypalobjects.com/${ CDN_PATH }`;
        const CDN_REGISTRY_HOSTNAME = new URL(CDN_REGISTRY).hostname;
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':        MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ CDN_REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ CDN_REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(CDN_REGISTRY)
            .get(`/${ MODULE_NAME }/info.json`)
            .query(keys => {
                if (keys['cache-bust']) {
                    return true;
                } else {
                    return false;
                }
            })
            .reply(200, info)
            .persist();

        const tarballReq = nock(CDN_REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:     onErrorCallback,
            cdnRegistry:  CDN_REGISTRY,
            logger
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
        }

        infoReq.done();
        tarballReq.done();
    });

    test(`Should poll for a module and install it with dependencies, then return the correct latest version`, async () => {
        const REGISTRY = 'https://registry.npmjs.org';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':      MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info)
            .persist();

        const tarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const dependencyNocks = [];

        for (const [ dependencyName, dependencyVersion ] of entries(MODULE_DEPENDENCIES)) {
            const tarballUri = `tarballs/${ dependencyName }/${ dependencyVersion }.tgz`;

            const dependencyInfoReq = nock(REGISTRY)
                .get(`/${ dependencyName }`)
                .reply(200, {
                    'name':      dependencyName,
                    'dist-tags': {
                        latest:  dependencyVersion
                    },
                    'versions': {
                        [ dependencyVersion.toString() ]: {
                            'dependencies': {},
                            'dist':         {
                                'tarball': `${ REGISTRY }/${ tarballUri }`
                            }
                        }
                    }
                })
                .persist();

            const dependencyTarballReq = nock(REGISTRY)
                .get(`/${ tarballUri }`)
                .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

            dependencyNocks.push(dependencyInfoReq);
            dependencyNocks.push(dependencyTarballReq);
        }
        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:      onErrorCallback,
            logger,
            dependencies: true
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
            expect(await exists(dependency.path)).toBeTruthy();
            expect(await exists(join(dependency.path, 'package.json'))).toBeTruthy();
        }

        infoReq.done();
        tarballReq.done();

        for (const dependencyNock of dependencyNocks) {
            dependencyNock.done();
        }
    });

    test(`Should poll for a module and install it with dependencies on a custom registry, then return the correct latest version`, async () => {
        const REGISTRY = 'https://npm.paypal.com';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':      MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info)
            .persist();

        const tarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const dependencyNocks = [];

        for (const [ dependencyName, dependencyVersion ] of entries(MODULE_DEPENDENCIES)) {
            const tarballUri = `tarballs/${ dependencyName }/${ dependencyVersion }.tgz`;

            const dependencyInfoReq = nock(REGISTRY)
                .get(`/${ dependencyName }`)
                .reply(200, {
                    'name':      dependencyName,
                    'dist-tags': {
                        latest:  dependencyVersion
                    },
                    'versions': {
                        [ dependencyVersion.toString() ]: {
                            'dependencies': {},
                            'dist':         {
                                'tarball': `${ REGISTRY }/${ tarballUri }`
                            }
                        }
                    }
                })
                .persist();

            const dependencyTarballReq = nock(REGISTRY)
                .get(`/${ tarballUri }`)
                .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

            dependencyNocks.push(dependencyInfoReq);
            dependencyNocks.push(dependencyTarballReq);
        }

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:      onErrorCallback,
            logger,
            dependencies: true,
            registry:     REGISTRY
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
            expect(await exists(dependency.path)).toBeTruthy();
            expect(await exists(join(dependency.path, 'package.json'))).toBeTruthy();
        }

        infoReq.done();
        tarballReq.done();

        for (const dependencyNock of dependencyNocks) {
            dependencyNock.done();
        }
    });

    test(`Should poll for a module and install it with dependencies on a cdn registry, then return the correct latest version`, async () => {
        const CDN_PATH = 'foo';
        const CDN_REGISTRY = `https://www.paypalobjects.com/${ CDN_PATH }`;
        const CDN_REGISTRY_HOSTNAME = new URL(CDN_REGISTRY).hostname;
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':      MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ CDN_REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ CDN_REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(CDN_REGISTRY)
            .get(`/${ MODULE_NAME }/info.json`)
            .query(keys => {
                if (keys['cache-bust']) {
                    return true;
                } else {
                    return false;
                }
            })
            .reply(200, info)
            .persist();

        const tarballReq = nock(CDN_REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const dependencyNocks = [];

        for (const [ dependencyName, dependencyVersion ] of entries(MODULE_DEPENDENCIES)) {
            const tarballUri = `tarballs/${ dependencyName }/${ dependencyVersion }.tgz`;

            const dependencyInfoReq = nock(CDN_REGISTRY)
                .get(`/${ dependencyName }/info.json`)
                .query(keys => {
                    if (keys['cache-bust']) {
                        return true;
                    } else {
                        return false;
                    }
                })
                .reply(200, {
                    'name':      dependencyName,
                    'dist-tags': {
                        latest:  dependencyVersion
                    },
                    'versions': {
                        [ dependencyVersion.toString() ]: {
                            'dependencies': {},
                            'dist':         {
                                'tarball': `${ CDN_REGISTRY }/${ tarballUri }`
                            }
                        }
                    }
                })
                .persist();

            const dependencyTarballReq = nock(CDN_REGISTRY)
                .get(`/${ tarballUri }`)
                .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

            dependencyNocks.push(dependencyInfoReq);
            dependencyNocks.push(dependencyTarballReq);
        }

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:      onErrorCallback,
            logger,
            dependencies: true,
            cdnRegistry:  CDN_REGISTRY
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
            expect(await exists(dependency.path)).toBeTruthy();
            expect(await exists(join(dependency.path, 'package.json'))).toBeTruthy();
        }

        infoReq.done();
        tarballReq.done();

        for (const dependencyNock of dependencyNocks) {
            dependencyNock.done();
        }
    });

    test(`Should poll for a module on a cdn registry and install it, fail and fall back to npm, then return the correct latest version`, async () => {
        const CDN_PATH = 'foo';
        const CDN_REGISTRY = `https://www.paypalobjects.com/${ CDN_PATH }`;
        const CDN_REGISTRY_HOSTNAME = new URL(CDN_REGISTRY).hostname;
        const REGISTRY = 'https://registry.npmjs.org';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':        MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(CDN_REGISTRY)
            .get(`/${ MODULE_NAME }/info.json`)
            .query(keys => {
                if (keys['cache-bust']) {
                    return true;
                } else {
                    return false;
                }
            })
            .reply(500)
            .persist();

        const fallbackInfoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info)
            .persist();

        const fallbackTarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:     onErrorCallback,
            cdnRegistry:  CDN_REGISTRY,
            logger
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, CDN_REGISTRY_HOSTNAME, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
        }

        infoReq.done();
        fallbackInfoReq.done();
        fallbackTarballReq.done();
    });

    test(`Should poll for a module and install it with caching, then return the correct latest version`, async () => {
        const REGISTRY = 'https://registry.npmjs.org';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':        MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info);

        const tarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const store = {};
        const cache = {
            get: (key) => {
                return Promise.resolve(store[key]);
            },
            set: (key, value) => {
                store[key] = value;
                // $FlowFixMe
                return Promise.resolve(value);
            }
        };

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:   onErrorCallback,
            cache,
            logger
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
        }

        infoReq.done();
        tarballReq.done();
    });

    test(`Should poll for a module and install it, then import it`, async () => {
        const REGISTRY = 'https://registry.npmjs.org';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        const info = {
            'name':        MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info)
            .persist();

        const tarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:   onErrorCallback,
            logger
        });

        expect(onErrorCallback).not.toHaveBeenCalled();

        const { getValue } = await poller.import();
        expect(await getValue('foo')).toEqual('foo');

        const { getChildValue } = await poller.import('child.js');
        expect(await getChildValue('bar')).toEqual('bar');

        await poller.cancel();

        infoReq.done();
        tarballReq.done();
    });

    test(`Should poll for a module and install it with dependencies, then return the correct latest version`, async () => {
        const REGISTRY = 'https://registry.npmjs.org';
        const MODULE_PREVIOUS_VERSION = '1.3.52';
        const TARBALL = `tarballs/${ MODULE_NAME }/${ MODULE_VERSION }.tgz`;
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };
        const CHILD_MODULES = [ 'foo' ];

        const info = {
            'name':      MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION
            },
            'versions': {
                [ MODULE_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                },
                [ MODULE_PREVIOUS_VERSION ]: {
                    'dependencies': MODULE_DEPENDENCIES,
                    'dist':         {
                        'tarball': `${ REGISTRY }/${ TARBALL }`
                    }
                }
            }
        };

        const infoReq = nock(REGISTRY)
            .get(`/${ MODULE_NAME }`)
            .reply(200, info)
            .persist();

        const tarballReq = nock(REGISTRY)
            .get(`/${ TARBALL }`)
            .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

        const dependencyNocks = [];

        for (const [ dependencyName, dependencyVersion ] of entries(MODULE_DEPENDENCIES)) {
            if (CHILD_MODULES.indexOf(dependencyName) === -1) {
                continue;
            }

            const tarballUri = `tarballs/${ dependencyName }/${ dependencyVersion }.tgz`;

            const dependencyInfoReq = nock(REGISTRY)
                .get(`/${ dependencyName }`)
                .reply(200, {
                    'name':      dependencyName,
                    'dist-tags': {
                        latest:  dependencyVersion
                    },
                    'versions': {
                        [ dependencyVersion.toString() ]: {
                            'dependencies': {},
                            'dist':         {
                                'tarball': `${ REGISTRY }/${ tarballUri }`
                            }
                        }
                    }
                })
                .persist();

            const dependencyTarballReq = nock(REGISTRY)
                .get(`/${ tarballUri }`)
                .replyWithFile(200, `${ __dirname  }/mocks/package.tgz`);

            dependencyNocks.push(dependencyInfoReq);
            dependencyNocks.push(dependencyTarballReq);
        }

        const onErrorCallback = jest.fn();
        const poller = poll({
            name:         MODULE_NAME,
            onError:      onErrorCallback,
            logger,
            dependencies: true,
            childModules: CHILD_MODULES
        });

        const result = await poller.get();
        await poller.cancel();

        expect(onErrorCallback).not.toHaveBeenCalled();

        expect(result.nodeModulesPath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES));
        expect(await exists(result.nodeModulesPath)).toBeTruthy();

        expect(result.modulePath).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ MODULE_NAME }`));
        expect(await exists(result.modulePath)).toBeTruthy();
        expect(await exists(join(result.modulePath, 'package.json'))).toBeTruthy();

        expect(result.version).toEqual(MODULE_VERSION);
        expect(result.previousVersion).toEqual(MODULE_PREVIOUS_VERSION);
        expect(result.dependencies).toBeTruthy();

        for (const [ dependencyName, dependency ] of entries(result.dependencies)) {
            if (CHILD_MODULES.indexOf(dependencyName) === -1) {
                continue;
            }

            expect(dependency).toBeTruthy();
            expect(dependency.version).toEqual(MODULE_DEPENDENCIES[dependencyName]);
            expect(dependency.path).toEqual(join(homedir(), __LIVE_MODULES__, `${ MODULE_NAME }_${ MODULE_VERSION }`, NODE_MODULES, `${ dependencyName }`));
            expect(await exists(dependency.path)).toBeTruthy();
            expect(await exists(join(dependency.path, 'package.json'))).toBeTruthy();
        }

        infoReq.done();
        tarballReq.done();

        for (const dependencyNock of dependencyNocks) {
            dependencyNock.done();
        }
    });
});
