/* @flow */

import { join } from 'path';
import { homedir } from 'os';
import { lookup } from 'dns';

import { mkdir, exists } from 'fs-extra';
import { exec } from 'npm-run';

import type { CacheType, LoggerType } from './types';
import { NODE_MODULES, PACKAGE_JSON } from './constants';

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

export async function createDirectory(dir : string, ...names : Array<string>) : Promise<string> {
    let path = dir;
    for (let name of names) {
        path = join(path, name);
        await makedir(path);
    }
    return path;
}

export async function createHomeDirectory(...names : Array<string>) : Promise<string> {
    try {
        return await createDirectory(homedir(), ...names);
    } catch (err) {

        let user = process.env.USER;

        if (user) {
            return await createDirectory(join('/home', user), ...names);
        }

        throw err;
    }
}

export async function sleep(period : number) : Promise<void> {
    return await new Promise(resolve => setTimeout(resolve, period));
}

export async function sleepWhile(condition : () => mixed, period : number, interval : number = 500) : Promise<void> {
    let start = Date.now();
    while ((Date.now() - start) < period && await condition()) {
        await sleep(interval);
    }
}

export type Poller<T> = {
    start : () => Poller<T>,
    stop : () => Poller<T>,
    result : () => Promise<T>
};

export function poll<T : mixed>({ handler, onError, period, multiplier = 2 } : { handler : () => Promise<T> | T, onError? : ?(Error) => void, period : number, multiplier? : number }) : Poller<T> {

    let interval = period;
    let running = false;

    let currentResult;
    let nextResult;

    let poller = async () => {
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

    let result = {
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

let memoizedFunctions = [];

export function memoize<R : mixed, A : Array<*>> (method : (...args: A) => Promise<R> | R) : ((...args: A) => Promise<R> | R) {

    let cache : { [key : string] : Promise<R> | R } = {};

    let resultFunction = function memoizedFunction(...args : A) : Promise<R> | R {

        let key : string;

        try {
            key = JSON.stringify(Array.prototype.slice.call(args));
        } catch (err) {
            throw new Error(`Arguments not serializable -- can not be used to memoize`);
        }

        if (!cache[key]) {
            cache[key] = method(...args);
        }

        if (cache[key] && typeof cache[key].then === 'function' && typeof cache[key].catch === 'function') {
            cache[key].catch(() => {
                delete cache[key];
            });
        }

        return cache[key];
    };

    resultFunction.clear = () => {
        cache = {};
    };

    memoizedFunctions.push(resultFunction);

    return resultFunction;
}

memoize.clear = () => {
    memoizedFunctions.forEach(fn => fn.clear());
};

export function memoizePromise<R : mixed, A : Array<*>> (method : (...args: A) => Promise<R>) : ((...args: A) => Promise<R>) {
    let resultFunction = memoize((...args : A) => {
        let result = method(...args);
        
        result.then(resultFunction.clear, resultFunction.clear);

        return result;
    });

    // $FlowFixMe
    return resultFunction;
}

export function inlineMemoizePromise<T, A : $ReadOnlyArray<mixed>>(method : (...args : A) => Promise<T>, key : string, handler : () => Promise<T>) : Promise<T> {
    method.__inline_memoize_promoise_cache__ = method.__inline_memoize_promoise_cache__ || {};

    if (method.__inline_memoize_promoise_cache__[key]) {
        return method.__inline_memoize_promoise_cache__[key];
    }

    const promise = handler();
    method.__inline_memoize_promoise_cache__[key] = promise;

    promise.then(() => {
        delete method.__inline_memoize_promoise_cache__[key];
    }, () => {
        delete method.__inline_memoize_promoise_cache__[key];
    });

    return promise;
}

export async function npmRun(command : string, options : Object) : Promise<string> {
    return await new Promise((resolve, reject) => {
        const startTime = Date.now();

        exec(command, options, (err, stdout, stderr) => {
            const elapsedTime = (Date.now() - startTime);

            if (stderr) {
                return reject(new Error(stderr.toString()));
            }

            if (err) {
                if (stdout) {
                    let json;
                    try {
                        json = JSON.parse(stdout);
                    } catch (err2) { // eslint-disable-line unicorn/catch-error-name
                        return reject(err);
                    }
                    if (json && json.error) {
                        let { code, summary, detail } = json.error;
                        return reject(new Error(`${ code } ${ summary }\n\n${ detail }`));
                    }
                    return reject(err);
                }

                if (err.killed) {
                    if (options.timeout && (options.timeout < (elapsedTime - options.timeout))) {
                        return reject(new Error(`Command timed out after ${ options.timeout }ms: ${ command }`));
                    }

                    return reject(new Error(`Command killed after ${ elapsedTime }ms: ${ command }`));
                }

                return reject(err);
            }

            return resolve(stdout.toString());
        });
    });
}

export function stringifyCommandLineOptions(options : { [string] : string | boolean }) : string {
    let result = [];
    for (let key of Object.keys(options)) {
        let value = options[key];
        let token = `--${ key }`;

        if (typeof value === 'boolean') {
            if (value === true) {
                result.push(token);
            } else if (value === false) {
                continue;
            }
        } else if (typeof value === 'string') {
            result.push(`${ token }=${ JSON.stringify(value) }`);
        }
    }
    return result.join(' ');
}

// $FlowFixMe
export const lookupDNS = memoizePromise(async (domain : string) : Promise<string> => {
    return await new Promise((resolve, reject) => {
        domain = domain.replace(/^https?:\/\//, '');
        lookup(domain, (err : Error, res : string) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
});

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

export async function cacheReadWrite<T>(cacheKey : string, handler : () => Promise<T>, { cache, logger } : { cache : ?CacheType, logger : LoggerType }) : Promise<T> {
    if (cache) {
        let cacheResult;

        try {
            const cachePromise = cache.get(cacheKey);
            cacheResult = await cachePromise;
            if (cacheResult) {
                cacheResult = JSON.parse(cacheResult);
            }
        } catch (err) {
            logger.info(`${ cacheKey }_cache_error`, { err: err.stack || err.toString() });
        }

        if (cacheResult) {
            logger.info(`${ cacheKey }_cache_hit`);
            return cacheResult;
        } else {
            logger.info(`${ cacheKey }_cache_miss`);
        }
    }
    
    const result = await handler();

    if (cache) {
        logger.info(`${ cacheKey }_cache_write`);

        try {
            await cache.set(cacheKey, JSON.stringify(result));
        } catch (err) {
            logger.info(`${ cacheKey }_cache_write_error`, { err: err.stack || err.toString() });
        }
    }

    return result;
}
