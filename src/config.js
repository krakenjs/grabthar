/* @flow */

import { tmpdir } from 'os';
import { join } from 'path';

import { DOTNPM } from './constants';

export const NPM_REGISTRY = 'https://registry.npmjs.org';

export const TMP_DIR = tmpdir();
export const NPM_CACHE_DIR = join(TMP_DIR, DOTNPM);

export const NPM_TIMEOUT = 30 * 1000;
export const NPM_INFO_TIMEOUT = 5 * 1000;

export const NPM_POLL_INTERVAL = 1 * 60;

export const MODULE_ROOT_NAME = '__live_modules__';
