/* @flow */

import { NPM_REGISTRY } from '../../src/config';

import type { MockCmd } from './mocks';

export function checkNpmOptions(cmd : MockCmd, { expectedRegistry = NPM_REGISTRY } : { expectedRegistry : string } = {}) {
    let { args, opts } = cmd;
    let [ command ] = args;
    let { silent, json, production, cache, registry } = opts;

    if (command !== 'npm') {
        throw new Error(`Expected npm to be the base command, got ${ command }`);
    }

    if (!silent) {
        throw new Error(`Expected npm to be run with --silent option`);
    }

    if (!json) {
        throw new Error(`Expected npm to be run with --json option`);
    }

    if (!production) {
        throw new Error(`Expected npm to be run with --production option`);
    }

    if (!cache) {
        throw new Error(`Expected npm to be passed --cache option`);
    }

    if (!registry || registry !== expectedRegistry) {
        throw new Error(`Expected npm to be passed --registry option with value of ${ expectedRegistry }, got ${ registry }`);
    }
}
