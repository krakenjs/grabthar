/* @flow */
/* eslint import/order: 0 */

import { mockExec, checkNpmOptions, wrapPromise } from './lib';

import { poll } from '../src';

beforeEach(() => {
    poll.flushCache();
});

test(`Should call the onError callback in the case of an error in npm info`, async () => {

    let exec;
    let poller;
    let error;

    try {
        await wrapPromise(async (reject) => {

            const MODULE_NAME = 'do-it-live-test-module';

            exec = mockExec();

            poller = poll({
                name:    MODULE_NAME,
                onError:    err => { reject(err); }
            });

            let next = await exec.next();
            checkNpmOptions(next.cmd);

            if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
                throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
            }
            
            await next.err('Something went wrong');
        });
        
    } catch (err) {
        error = err;
    }

    if (!error) {
        throw new Error(`Expected error to be thrown`);
    }

    if (error.message !== 'Something went wrong') {
        throw error;
    }

    // $FlowFixMe
    exec.cancel();
    // $FlowFixMe
    poller.cancel();
});

test(`Should call the onError callback in the case of an error in npm install`, async () => {

    let exec;
    let poller;
    let error;

    try {
        await wrapPromise(async (reject) => {

            const MODULE_NAME = 'do-it-live-test-module';
            const MODULE_VERSION = '1.3.53';

            let pkg = {
                'version':   MODULE_VERSION,
                'dist-tags': {
                    'latest': MODULE_VERSION
                }
            };

            exec = mockExec();

            poller = poll({
                name:    MODULE_NAME,
                onError:    err => { reject(err); }
            });

            let next = await exec.next();
            checkNpmOptions(next.cmd);

            if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
                throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
            }

            await next.res(JSON.stringify(pkg));

            next = await exec.next();
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

    if (error.message !== 'Something went wrong') {
        throw error;
    }

    // $FlowFixMe
    exec.cancel();
    // $FlowFixMe
    poller.cancel();
});

test(`Should fail when trying to get a module other than latest when tags not specified`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';

        let pkg = {
            'version':   MODULE_VERSION,
            'dist-tags': {
                'latest': MODULE_VERSION
            }
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            onError: err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        let error;

        try {
            await poller.get('foo');
        } catch (err) {
            error = err;
        }

        if (!error) {
            throw new Error(`Expected error to be thrown`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should fail when trying to get a module not specified in tags`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';

        let pkg = {
            'version':   MODULE_VERSION,
            'dist-tags': {
                'release': MODULE_VERSION,
                'foo':     MODULE_VERSION
            }
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            tags:    [ 'release', 'foo' ],
            onError: err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        let error;

        try {
            await poller.get('bar');
        } catch (err) {
            error = err;
        }

        if (!error) {
            throw new Error(`Expected error to be thrown`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should fail when trying to get latest module not specified in tags`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';

        let pkg = {
            'version':   MODULE_VERSION,
            'dist-tags': {
                'release': MODULE_VERSION,
                'foo':     MODULE_VERSION
            }
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            tags:    [ 'release', 'foo' ],
            onError: err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        let error;

        try {
            await poller.get('latest');
        } catch (err) {
            error = err;
        }

        if (!error) {
            throw new Error(`Expected error to be thrown`);
        }

        exec.cancel();
        poller.cancel();
    });
});
