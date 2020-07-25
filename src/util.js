/* @flow */

import { join } from 'path';
import { homedir, tmpdir } from 'os';

import { mkdir, exists, readFile, removeSync, writeFileSync, existsSync } from 'fs-extra';
import rmfr from 'rmfr';

import type { CacheType, LoggerType } from './types';
import { NODE_MODULES, PACKAGE_JSON, LOCK } from './constants';

export function clearObject<T>(obj : { [string] : T }) : void {
    for (const key of Object.keys(obj)) {
        delete obj[key];
    }
}

export async function makedir(dir : string) : Promise<void> {
    try {
        if (!await exists(dir)) {
            await mkdir(dir);
        }
    } catch (err) {
        if (err.code === 'EEXIST') {
            return;
        }
        throw err;
    }
}

export async function createDirectory(dir : string, ...names : $ReadOnlyArray<string>) : Promise<string> {
    let path = dir;
    for (const name of names) {
        path = join(path, name);
        await makedir(path);
    }
    return path;
}

export async function createHomeDirectory(...names : $ReadOnlyArray<string>) : Promise<string> {
    try {
        return await createDirectory(homedir(), ...names);
    } catch (err) {

        const user = process.env.USER;

        if (user) {
            return await createDirectory(join('/home', user), ...names);
        }

        throw err;
    }
}

export async function sleep(period : number) : Promise<void> {
    return await new Promise(resolve => setTimeout(resolve, period));
}

export function getPromise<T>() : {| promise : Promise<T>, resolve : (T) => void, reject : (mixed) => void |} {
    let resolve;
    let reject;
    // eslint-disable-next-line promise/param-names
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    if (!resolve || !reject) {
        throw new Error(`Could not instantiate promise`);
    }
    return { promise, resolve, reject };
}

export async function sleepWhile(condition : () => mixed, period : number, interval : number = 500) : Promise<void> {
    const start = Date.now();
    while ((Date.now() - start) < period && await condition()) {
        await sleep(interval);
    }
}

export type Poller<T> = {|
    start : () => Poller<T>,
    stop : () => Poller<T>,
    result : () => Promise<T>
|};

export function poll<T : mixed>({ handler, onError, period, multiplier = 2 } : {| handler : () => Promise<T> | T, onError? : ?(Error) => void, period : number, multiplier? : number |}) : Poller<T> {

    let interval = period;
    let running = false;

    let currentResult;
    let nextResult;

    const poller = async () => {
        // eslint-disable-next-line no-unmodified-loop-condition
        while (running) {
            let success = true;

            nextResult = handler();
            currentResult = currentResult || nextResult;

            try {
                await nextResult;
            } catch (err) {
                if (onError) {
                    onError(err);
                }
                success = false;
            }

            if (success) {
                interval = period;
                currentResult = nextResult;
            } else {
                interval *= multiplier;
            }

            if (!running) {
                break;
            }

            await sleepWhile(() => running, interval);
        }
    };

    const result = {
        start: () => {
            running = true;
            poller();
            return result;
        },
        stop: () => {
            running = false;
            return result;
        },
        result: async () => {
            return await currentResult;
        }
    };

    return result;
}

export function resolveModuleDirectory(name : string, paths? : $ReadOnlyArray<string>) : ?string {
    let dir;

    try {
        // $FlowFixMe
        dir = require.resolve(`${ name }/${ PACKAGE_JSON }`, { paths });
    } catch (err) {
        return;
    }

    return dir.split('/').slice(0, -1).join('/');
}

export async function resolveNodeModulesDirectory(name : string, paths? : $ReadOnlyArray<string>) : Promise<?string> {
    const moduleDir = resolveModuleDirectory(name, paths);

    if (!moduleDir) {
        return;
    }

    const localNodeModules = join(moduleDir, NODE_MODULES);

    if (await exists(localNodeModules)) {
        return localNodeModules;
    }

    const splitDir = moduleDir.split('/');
    const nodeModulesIndex = splitDir.lastIndexOf(NODE_MODULES);

    if (nodeModulesIndex !== -1) {
        return splitDir.slice(0, nodeModulesIndex + 1).join('/');
    }
}

const memoizePromiseCache = new Map();

type MemoizePromiseOpts = {|
    lifetime? : number
|};

export function memoizePromise<T, A : $ReadOnlyArray<*>, F : (...args : A) => Promise<T>>(fn : F, opts? : MemoizePromiseOpts) : F {
    const {
        lifetime = 0
    } = opts || {};

    const memoizedFunction = async (...args) => {
        const cacheKey = JSON.stringify(args);
        const cache = memoizePromiseCache.get(fn) || {};
        const cacheResult = cache[cacheKey];

        memoizePromiseCache.set(fn, cache);

        if (!cacheResult) {
            const cacheObj = {};

            const resultPromise = fn(...args);
            cacheObj.resultPromise = resultPromise;

            cache[cacheKey] = cacheObj;

            let result;
            try {
                result = await resultPromise;
            } catch (err) {
                delete cache[cacheKey];
                throw err;
            }

            if (lifetime) {
                cacheObj.expiry = Date.now() + lifetime;
            } else {
                delete cache[cacheKey];
            }

            return result;
        }

        const { resultPromise, expiry } = cacheResult;

        if (!expiry || Date.now() < expiry) {
            return await resultPromise;
        }

        delete cache[cacheKey];
    };

    // $FlowFixMe
    return memoizedFunction;
}

memoizePromise.reset = () => {
    memoizePromiseCache.clear();
};

const backupMemoryCache = {};

export async function cacheReadWrite<T>(cacheKey : string, handler : () => Promise<T>, { cache, logger } : {| cache : ?CacheType, logger : LoggerType |}) : Promise<T> {
    const strategies = [
        async () => {
            if (cache) {
                logger.info(`${ cacheKey }_cache_attempt`);
                const result : ?string = await cache.get(cacheKey);
                
                if (result) {
                    logger.info(`${ cacheKey }_cache_hit`);
                    return JSON.parse(result);
                } else {
                    logger.info(`${ cacheKey }_cache_miss`);
                }
            }
        },

        async () => {
            const result = await handler();
            backupMemoryCache[cacheKey] = result;

            if (result && cache) {
                try {
                    await cache.set(cacheKey, JSON.stringify(result));
                } catch (err) {
                    logger.info(`${ cacheKey }_cache_write_error`, { err: err.stack || err.toString() });
                }
            }

            return result;
        },

        async () => {
            if (backupMemoryCache[cacheKey]) {
                return await backupMemoryCache[cacheKey];
            }
        }
    ];

    let error;

    for (const strategy of strategies) {
        let result;

        try {
            result = await strategy();
        } catch (err) {
            error = err || error;
            logger.warn(`grabthar_cache_strategy_error`, { err: err.stack || err.toString() });
        }

        if (result) {
            return result;
        }
    }

    if (error) {
        throw error;
    } else {
        throw new Error(`No strategy succeeded for ${ cacheKey }`);
    }
}

cacheReadWrite.clear = () => {
    memoizePromise.reset();
    clearObject(backupMemoryCache);
};

let locked = false;
const MAX_LOCK_TIME = 2 * 60 * 1000;
const LOCK_FILE = join(tmpdir(), LOCK);

const acquireLock = () => {
    locked = true;
    writeFileSync(LOCK_FILE, parseInt(Date.now(), 10).toString());
};

const isLocked = () => {
    return locked || existsSync(LOCK_FILE);
};

const releaseLock = () => {
    if (isLocked) {
        locked = false;
        removeSync(LOCK_FILE);
    }
};

const getLockTime = async () : Promise<number> => {
    const lock = await readFile(LOCK_FILE);
    const time = parseInt(lock.toString(), 10);
    return time;
};

export async function useFileSystemLock<T>(task : () => Promise<T>) : Promise<T> {
    const startTime = parseInt(Date.now(), 10);
    
    while (isLocked()) {
        const time = await getLockTime();
        
        if ((startTime - time) > MAX_LOCK_TIME) {
            releaseLock();
        } else {
            await sleep(500);
            continue;
        }
    }

    let result;

    acquireLock();

    try {
        result = await task();
    } catch (err) {
        releaseLock();
        throw err;
    }

    releaseLock();

    return result;
}

export function sanitizeString(str : string) : string {
    return str.replace(/[^a-zA-Z0-9]+/g, '_');
}

export async function rmrf(dir : string) : Promise<void> {
    try {
        await rmfr(dir);
    } catch (err) {
        // pass
    }
}

export function isValidDependencyVersion(version : string) : boolean {
    return Boolean(version.match(/^\d+\.\d+\.\d+$/));
}

export function identity<T>(item : T) : T {
    return item;
}
