/* @flow */

import { tmpdir } from 'os';

export const NPM_REGISTRY = 'https://registry.npmjs.org';

export const TMP_DIR = tmpdir();

export const NPM_POLL_INTERVAL = 1 * 60;

export const MODULE_ROOT_NAME = '__live_modules__';

export const CDN_REGISTRY_INFO_FILENAME = 'info.json';
export const CDN_REGISTRY_INFO_CACHEBUST_URL_TIME = 60 * 1000;

export const INFO_MEMORY_CACHE_LIFETIME = 30 * 1000;
