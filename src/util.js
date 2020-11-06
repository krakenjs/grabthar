/* @flow */

import { join, basename, dirname } from 'path';
import { homedir, tmpdir } from 'os';

import { exists, removeSync, writeFileSync, existsSync, ensureDirSync, readFileSync, ensureDir, readdir } from 'fs-extra';
import rmfr from 'rmfr';
import uuid from 'uuid';
import processExists from 'process-exists';
import nodeCleanup from 'node-cleanup';

import type { CacheType, LoggerType } from './types';
import { NODE_MODULES, PACKAGE_JSON, LOCK } from './constants';

export function clearObject<T>(obj : { [string] : T }) : void {
    for (const key of Object.keys(obj)) {
        delete obj[key];
    }
}

export async function createHomeDirectory(...names : $ReadOnlyArray<string>) : Promise<string> {
    try {
        const dir = join(homedir(), ...names);
        await ensureDir(dir);
        return dir;
    } catch (err) {
        const user = process.env.USER;

        if (user) {
            const dir = join('/home', user, ...names);
            await ensureDir(dir);
            return dir;
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

        if (cacheResult) {
            const { resultPromise, expiry } = cacheResult;

            if (!expiry || Date.now() < expiry) {
                return await resultPromise;
            }

            delete cache[cacheKey];
        }

        const resultPromise = fn(...args);
        const cacheObj = { resultPromise, expiry: 0 };

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
                const result : ?string = await cache.get(cacheKey);
                
                if (result) {
                    return JSON.parse(result);
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
                    logger.warn(`${ cacheKey }_cache_write_error`, { err: err.stack || err.toString() });
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

const MAX_LOCK_TIME = 60 * 1000;

const activeLocks = {};

const acquireLock = (lockFile : string) => {
    let resolve;
    let reject;
    // eslint-disable-next-line promise/param-names
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    activeLocks[lockFile] = { promise, resolve, reject };
    ensureDirSync(dirname(lockFile));
    writeFileSync(lockFile, parseInt(Date.now(), 10).toString());
};

const isLocked = (lockFile : string) => {
    return activeLocks[lockFile] || existsSync(lockFile);
};

const releaseLock = (lockFile : string) => {
    if (activeLocks[lockFile]) {
        activeLocks[lockFile].resolve();
        delete activeLocks[lockFile];
    }

    if (existsSync(lockFile)) {
        removeSync(lockFile);
    }
};

const getLockTime = (lockFile : string) : ?number => {
    if (!existsSync(lockFile)) {
        return;
    }

    const lock = readFileSync(lockFile);
    const time = parseInt(lock.toString(), 10);
    return time;
};

const awaitLock = async (lockFile : string) => {
    if (!isLocked(lockFile)) {
        return;
    }

    if (activeLocks[lockFile]) {
        await activeLocks[lockFile].promise;
        await sleep(10);
    }

    if (!isLocked(lockFile)) {
        return;
    }

    await new Promise(resolve => {
        const check = () => {
            if (!isLocked(lockFile)) {
                resolve();
                return;
            }

            const startTime = parseInt(Date.now(), 10);
            const time = getLockTime(lockFile);
            
            if (!time || (startTime - time) > MAX_LOCK_TIME) {
                releaseLock(lockFile);
                resolve();
                return;
            }
            
            return sleep(500).then(check);
        };

        check();
    });

    await sleep(10);
    if (isLocked(lockFile)) {
        return await awaitLock(lockFile);
    }
};

nodeCleanup(() => {
    for (const lockFile of Object.keys(activeLocks)) {
        releaseLock(lockFile);
    }
});

export async function withFileSystemLock<T>(task : () => Promise<T>, lockDir? : string = tmpdir()) : Promise<T> {
    const lockFile = join(lockDir, LOCK);

    await awaitLock(lockFile);
    acquireLock(lockFile);

    try {
        return await task();
    } finally {
        releaseLock(lockFile);
    }
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

export function tryRemove(path : string) {
    try {
        if (existsSync(path)) {
            removeSync(path);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
    }
}

export async function tryRmrf(dir : string) : Promise<void> {
    try {
        await rmrf(dir);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
    }
}

export async function getTemporaryDirectory(name : string) : Promise<string> {
    const tmpDir = tmpdir();

    try {
        for (const folder of await readdir(tmpDir)) {
            const match = folder.match(/^grabthar-tmp-[\w-]+-(\d+)$/);

            if (!match) {
                if (folder.match(/^grabthar-tmp-package-/)) {
                    tryRmrf(join(tmpDir, folder));
                }

                continue;
            }

            const pid = parseInt(match[1], 10);
            if (typeof pid !== 'number' || pid === process.pid || await processExists(pid)) {
                continue;
            }

            tryRmrf(join(tmpDir, folder));
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
    }


    return join(tmpDir, `grabthar-tmp-${ name.replace(/[^a-zA-Z0-9_-]/g, '') }-${ uuid.v4().slice(0, 8) }-${ process.pid }`);
}

export function jumpUpDir(path : string, target : string) : ?string {
    while (path && path !== '/') {
        path = join(path, '..');

        if (basename(path) === target) {
            return path;
        }
    }
}

export function dynamicRequire<T>(path : string) : T {
    // $FlowFixMe
    return require(path); // eslint-disable-line security/detect-non-literal-require
}

export function dynamicRequireRelative<T>(name : string, nodeModulesPath : ?string) : T {
    if (!nodeModulesPath) {
        return dynamicRequire(name);
    }

    while (nodeModulesPath) {
        try {
            return dynamicRequire(join(nodeModulesPath, name));
        } catch (err) {
            nodeModulesPath = jumpUpDir(nodeModulesPath, NODE_MODULES);
            
            if (!nodeModulesPath) {
                throw err;
            }
        }
    }

    throw new Error(`Can not import ${ name }`);
}
