/* @flow */
/* eslint import/order: 0, max-lines: 0 */

import { mockExec, checkNpmOptions, wrapPromise } from './lib';

import { poll } from '../src';

beforeEach(() => {
    poll.flushCache();
});

test(`Should poll for a module and install it, then return the correct latest version`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        let pkg = {
            'version':   MODULE_VERSION,
            'dist-tags': {
                'latest': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            onError: reject
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

        let { prefix } = next.cmd.opts;

        if (!prefix) {
            throw new Error(`Expected npm install to pass prefix`);
        }

        await next.res(JSON.stringify({}));

        let pollerPromise = poller.get();

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let { root, version, dependencies } = await pollerPromise;

        if (root !== prefix) {
            throw new Error(`Expected npm install prefix '${ prefix }' to match moduleRoot '${ root }'`);
        }

        if (version !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ version }'`);
        }

        if (JSON.stringify(dependencies) !== JSON.stringify(MODULE_DEPENDENCIES)) {
            throw new Error(`Expected dependencies to match up: ${ JSON.stringify(dependencies) } vs ${ JSON.stringify(MODULE_DEPENDENCIES) }`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should poll for a module and install it, then explicitly return the correct latest version`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        let pkg = {
            'version':   MODULE_VERSION,
            'dist-tags': {
                'latest': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            tags:    [ 'latest' ],
            onError: reject
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

        let { prefix } = next.cmd.opts;

        if (!prefix) {
            throw new Error(`Expected npm install to pass prefix`);
        }

        await next.res(JSON.stringify({}));

        let pollerPromise = poller.get('latest');

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let { root, version, dependencies } = await pollerPromise;

        if (root !== prefix) {
            throw new Error(`Expected npm install prefix '${ prefix }' to match moduleRoot '${ root }'`);
        }

        if (version !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ version }'`);
        }

        if (JSON.stringify(dependencies) !== JSON.stringify(MODULE_DEPENDENCIES)) {
            throw new Error(`Expected dependencies to match up: ${ JSON.stringify(dependencies) } vs ${ JSON.stringify(MODULE_DEPENDENCIES) }`);
        }

        exec.cancel();
        poller.cancel();
    });
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

        let pkg = {
            'version':   MODULE_VERSION,
            'dist-tags': {
                'release': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            tags:    [ 'release' ],
            onError: reject
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

        let { prefix } = next.cmd.opts;

        if (!prefix) {
            throw new Error(`Expected npm install to pass prefix`);
        }

        await next.res(JSON.stringify({}));

        let pollerPromise = poller.get();

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let { root, version, dependencies } = await pollerPromise;

        if (root !== prefix) {
            throw new Error(`Expected npm install prefix '${ prefix }' to match moduleRoot '${ root }'`);
        }

        if (version !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ version }'`);
        }

        if (JSON.stringify(dependencies) !== JSON.stringify(MODULE_DEPENDENCIES)) {
            throw new Error(`Expected dependencies to match up: ${ JSON.stringify(dependencies) } vs ${ JSON.stringify(MODULE_DEPENDENCIES) }`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should poll for a module and install it, then explicitly return the correct release version`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        let pkg = {
            'version':   MODULE_VERSION,
            'dist-tags': {
                'release': MODULE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            tags:    [ 'release' ],
            onError: reject
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

        let { prefix } = next.cmd.opts;

        if (!prefix) {
            throw new Error(`Expected npm install to pass prefix`);
        }

        await next.res(JSON.stringify({}));

        let pollerPromise = poller.get('release');

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let { root, version, dependencies } = await pollerPromise;

        if (root !== prefix) {
            throw new Error(`Expected npm install prefix '${ prefix }' to match moduleRoot '${ root }'`);
        }

        if (version !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ version }'`);
        }

        if (JSON.stringify(dependencies) !== JSON.stringify(MODULE_DEPENDENCIES)) {
            throw new Error(`Expected dependencies to match up: ${ JSON.stringify(dependencies) } vs ${ JSON.stringify(MODULE_DEPENDENCIES) }`);
        }

        exec.cancel();
        poller.cancel();
    });
});

test(`Should use the base version if the latest version is not available`, async () => {
    await wrapPromise(async (reject) => {

        const MODULE_NAME = 'do-it-live-test-module';
        const MODULE_VERSION = '1.3.53';
        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        let pkg = {
            'version':      MODULE_VERSION,
            'dependencies': MODULE_DEPENDENCIES
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

        await next.res(JSON.stringify({}));

        let pollerPromise = poller.get();

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ MODULE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ MODULE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let { version } = await pollerPromise;

        if (version !== MODULE_VERSION) {
            throw new Error(`Expected npm install version '${ MODULE_VERSION }' to match moduleVersion '${ version }'`);
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

        const MODULE_DEPENDENCIES = {
            foo: '1.2.3',
            bar: '56.0.3',
            baz: '6.12.99'
        };

        let pkg = {
            'version':   LATEST_VERSION,
            'dist-tags': {
                'latest':  LATEST_VERSION,
                'release': RELEASE_VERSION
            },
            'dependencies': MODULE_DEPENDENCIES
        };

        let exec = mockExec();

        let poller = poll({
            name:    MODULE_NAME,
            tags:    [ 'release', 'latest' ],
            onError: err => { reject(err); }
        });

        let next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== MODULE_NAME) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let releaseVersionInstalled = false;
        let latestVersionInstalled = false;

        for (let i = 0; i < 2; i += 1) {
            next = await exec.next();
            checkNpmOptions(next.cmd);

            if (next.cmd.args[1] !== 'install') {
                throw new Error(`Expected 'npm install ${ MODULE_NAME }' to be run, got '${ next.cmd.args.join(' ') }'`);
            }

            if (next.cmd.args[2] === `${ MODULE_NAME }@${ RELEASE_VERSION }`) {
                releaseVersionInstalled = true;
            } else if (next.cmd.args[2] === `${ MODULE_NAME }@${ LATEST_VERSION }`) {
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

        let releasePollerPromise = poller.get('release');

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ RELEASE_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ RELEASE_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let { version: releaseVersion } = await releasePollerPromise;

        if (releaseVersion !== RELEASE_VERSION) {
            throw new Error(`Expected npm install version '${ RELEASE_VERSION }' to match moduleVersion '${ releaseVersion }'`);
        }

        let latestPollerPromise = poller.get('latest');

        next = await exec.next();
        checkNpmOptions(next.cmd);

        if (next.cmd.args[1] !== 'info' || next.cmd.args[2] !== `${ MODULE_NAME }@${ LATEST_VERSION }`) {
            throw new Error(`Expected 'npm info ${ MODULE_NAME }@${ LATEST_VERSION }' to be run, got '${ next.cmd.args.join(' ') }'`);
        }

        await next.res(JSON.stringify(pkg));

        let { version: latestVersion } = await latestPollerPromise;

        if (latestVersion !== LATEST_VERSION) {
            throw new Error(`Expected npm install version '${ LATEST_VERSION }' to match moduleVersion '${ latestVersion }'`);
        }

        exec.cancel();
        poller.cancel();
    });
});
