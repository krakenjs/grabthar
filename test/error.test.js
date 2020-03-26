/* @flow */
/* eslint import/order: 0 */

import nock from 'nock';

import { mockExec, checkNpmOptions } from './lib';

import { poll } from '../src';

beforeEach(() => {
    poll.flushCache();

    nock('https://registry.npmjs.org')
        .get(`/info`)
        .reply(200);
});

test(`Should fail on get in the case of an error in npm info`, async () => {
    let poller;
    let error;

    try {
        const MODULE_NAME = 'grabthar-test-module';

        const getReq = nock('https://registry.npmjs.org')
            .get(`/${ MODULE_NAME }`)
            .reply(500);

        poller = poll({
            name:    MODULE_NAME
        });

        getReq.done();

        await poller.get();

    } catch (err) {
        error = err;
    }

    if (!error) {
        throw new Error(`Expected error to be thrown`);
    }

    // $FlowFixMe
    poller.cancel();
});

test(`Should call the onError callback in the case of an error in npm info`, async () => {

    let poller;
    let error;

    try {
        await new Promise((resolve, reject) => {

            const MODULE_NAME = 'grabthar-test-module';

            const getReq = nock('https://registry.npmjs.org')
                .get(`/${ MODULE_NAME }`)
                .reply(500);

            poller = poll({
                name:    MODULE_NAME,
                onError: (err) => { reject(err); }
            });

            getReq.done();
        });
        
    } catch (err) {
        error = err;
    }

    if (!error) {
        throw new Error(`Expected error to be thrown`);
    }

    // $FlowFixMe
    poller.cancel();
});

test(`Should fail on get in the case of an error in npm install`, async () => {

    const exec = mockExec();
    let poller;
    let error;

    try {
        const MODULE_NAME = 'grabthar-test-module';
        const MODULE_VERSION = '4.0.4';

        const info = {
            'name':      MODULE_NAME,
            'dist-tags': {
                latest: MODULE_VERSION
            },
            'versions': {
                [MODULE_VERSION]: {
                    'dependencies': {},
                    'dist':         {}
                }
            }
        };

        const getReq = nock('https://registry.npmjs.org')
            .get(`/${ MODULE_NAME }`)
            .reply(200, info);

        poller = poll({
            name: MODULE_NAME
        });

        getReq.done();

        const next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.err('Something went wrong');

        await poller.get();

    } catch (err) {
        error = err;
    }

    if (!error) {
        throw new Error(`Expected error to be thrown`);
    }

    // $FlowFixMe
    poller.cancel();
    exec.cancel();
});

test(`Should call the onError callback in the case of an error in npm install`, async () => {
    
    const exec = mockExec();
    let poller;
    let error;

    try {
        // eslint-disable-next-line no-async-promise-executor
        await new Promise(async (resolve, reject) => {
            const MODULE_NAME = 'grabthar-test-module';
            const MODULE_VERSION = '4.0.4';

            const info = {
                'name':      MODULE_NAME,
                'dist-tags': {
                    latest: MODULE_VERSION
                },
                'versions': {
                    [ MODULE_VERSION ]: {
                        'dependencies': {},
                        'dist':         {}
                    }
                }
            };

            const getReq = nock('https://registry.npmjs.org')
                .get(`/${ MODULE_NAME }`)
                .reply(200, info);

            poller = poll({
                name:    MODULE_NAME,
                onError: reject
            });

            getReq.done();

            const next = await exec.next();
            checkNpmOptions(next.cmd);

            if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
                throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
            }

            await next.err('Something went wrong');
        });

    } catch (err) {
        error = err;
    }

    if (!error) {
        throw new Error(`Expected error to be thrown`);
    }

    // $FlowFixMe
    poller.cancel();
    exec.cancel();
});

test(`Should fail when trying to get a module other than latest when tags not specified`, async () => {
    let poller;
    let error;

    try {
        const MODULE_NAME = 'grabthar-test-module';
        const MODULE_VERSION = '4.0.4';
        const RELEASE_VERSION = '5.0.5';

        const info = {
            'name':      MODULE_NAME,
            'dist-tags': {
                latest:  MODULE_VERSION,
                release: RELEASE_VERSION
            },
            'versions': {
                [MODULE_VERSION]: {
                    'dependencies': {},
                    'dist':         {}
                },
                [RELEASE_VERSION]: {
                    'dependencies': {},
                    'dist':         {}
                }
            }
        };

        const getReq = nock('https://registry.npmjs.org')
            .get(`/${ MODULE_NAME }`)
            .reply(200, info);

        poller = poll({
            name: MODULE_NAME
        });

        getReq.done();

        await poller.get('release');

    } catch (err) {
        error = err;
    }

    if (!error) {
        throw new Error(`Expected error to be thrown`);
    }

    // $FlowFixMe
    poller.cancel();
});
