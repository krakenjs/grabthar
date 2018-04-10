/* @flow */
/* eslint import/order: 0 */

import { mockExec, checkNpmOptions, wrapPromise } from './lib';

import { poll } from '../src';

beforeEach(() => {
    poll.flushCache();
});

test(`Should poll for a module and install it, then return the correct release version`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        let exec = mockExec();

        let poller = poll({
            moduleName: MODULE_NAME,
            onError:    err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({
            'version':   MODULE_VERSION,
            'dist-tags': {
                'release': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        }));

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        let { prefix } = next.cmd.opts;

        if (!prefix) {
            throw new Error(`Expected npm install to pass prefix`);
        }

        await next.res(JSON.stringify({}));

        let { moduleRoot, moduleVersion } = await poller.getReleaseModule();

        if (moduleRoot !== prefix) {
            throw new Error(`Expected npm install prefix '${ prefix }' to match moduleRoot '${ moduleRoot }'`);
        }

        if (moduleVersion !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ moduleVersion }'`);
        }

        let dependencyPromise = poller.getReleaseModuleDependencies();

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({
            'version':   MODULE_VERSION,
            'dist-tags': {
                'release': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        }));

        let dependencies = await dependencyPromise;

        if (JSON.stringify(dependencies) !== JSON.stringify(MODULE_DEPENDENCIES)) {
            throw new Error(`Expected dependencies to match up: ${ JSON.stringify(dependencies) } vs ${ JSON.stringify(MODULE_DEPENDENCIES) }`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should poll for a module and install it, then return the correct latest version`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';
        const MODULE_DEPENDENCIES = {
            foo2: '1.4.3',
            bar:  '53.0.0',
            baz:  '0.12.99'
        };

        let exec = mockExec();

        let poller = poll({
            moduleName: MODULE_NAME,
            onError:    err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({
            'version':   MODULE_VERSION,
            'dist-tags': {
                'latest': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        }));

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        let { prefix } = next.cmd.opts;

        if (!prefix) {
            throw new Error(`Expected npm install to pass prefix`);
        }

        await next.res(JSON.stringify({}));

        let { moduleRoot, moduleVersion } = await poller.getLatestModule();

        if (moduleRoot !== prefix) {
            throw new Error(`Expected npm install prefix '${ prefix }' to match moduleRoot '${ moduleRoot }'`);
        }

        if (moduleVersion !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ moduleVersion }'`);
        }

        let dependencyPromise = poller.getLatestModuleDependencies();

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({
            'version':   MODULE_VERSION,
            'dist-tags': {
                'latest': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        }));

        let dependencies = await dependencyPromise;

        if (JSON.stringify(dependencies) !== JSON.stringify(MODULE_DEPENDENCIES)) {
            throw new Error(`Expected dependencies to match up: ${ JSON.stringify(dependencies) } vs ${ JSON.stringify(MODULE_DEPENDENCIES) }`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should use the base version if the release version is not available`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';

        let exec = mockExec();

        let poller = poll({
            moduleName: MODULE_NAME,
            onError:    err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({
            'version':   MODULE_VERSION
        }));

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({}));

        let { moduleVersion } = await poller.getReleaseModule();

        if (moduleVersion !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ moduleVersion }'`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should use the base version if the latest version is not available`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';

        let exec = mockExec();

        let poller = poll({
            moduleName: MODULE_NAME,
            onError:    err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({
            'version': MODULE_VERSION
        }));

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'install' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({}));

        let { moduleVersion } = await poller.getLatestModule();

        if (moduleVersion !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ moduleVersion }'`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should install both release and latest versions if they are different`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const RELEASE_VERSION = '1.2.563';
        const LATEST_VERSION = '1.0.4';

        let exec = mockExec();

        let poller = poll({
            moduleName: MODULE_NAME,
            onError:    err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify({
            'version':   LATEST_VERSION,
            'dist-tags': {
                'release': RELEASE_VERSION,
                'latest':  LATEST_VERSION

            }
        }));

        let releaseVersionInstalled = false;
        let latestVersionInstalled = false;

        for (let i = 0; i < 2; i += 1) {
            next = await exec.next();
            checkNpmOptions(next.cmd);

            if (next.cmd.args[1] !== 'install') {
                throw new Error(`Expected 'npm install ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
            }

            if (next.cmd.args[2] !== `${ MODULE_NAME }@${ RELEASE_VERSION }`) {
                releaseVersionInstalled = true;
            } else if (next.cmd.args[2] !== `${ MODULE_NAME }@${ LATEST_VERSION }`) {
                latestVersionInstalled = true;
            } else {
                throw new Error(`Expected 'npm install ${ MODULE_NAME }@${ RELEASE_VERSION }' or 'npm install ${ MODULE_NAME }@${ LATEST_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
            }

            await next.res(JSON.stringify({}));
        }

        if (!releaseVersionInstalled) {
            throw new Error(`Expected release version to be installed`);
        }

        if (!latestVersionInstalled) {
            throw new Error(`Expected latest version to be installed`);
        }

        let { moduleVersion: releaseVersion } = await poller.getReleaseModule();

        if (releaseVersion !== RELEASE_VERSION) {
            throw new Error(`Expected npm install version '${ RELEASE_VERSION }' to match moduleVersion '${ releaseVersion }'`);
        }

        let { moduleVersion: latestVersion } = await poller.getLatestModule();

        if (latestVersion !== LATEST_VERSION) {
            throw new Error(`Expected npm install version '${ LATEST_VERSION }' to match moduleVersion '${ latestVersion }'`);
        }

        exec.cancel();
        poller.cancel();
    });
});
