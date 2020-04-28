/* @flow */

import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { lookup } from 'dns';

import { mkdir, exists, readFile, remove, writeFile } from 'fs-extra';
import rmfr from 'rmfr';
import { exec } from 'npm-run';

import type { CacheType, LoggerType } from './types';
import { NODE_MODULES, PACKAGE_JSON, LOCK } from './constants';

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
                    } catch (err2) {
                        return reject(err);
                    }
                    if (json && json.error) {
                        const { code, summary, detail } = json.error;
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
    const result = [];
    for (const key of Object.keys(options)) {
        const value = options[key];
        const token = `--${ key }`;

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
export const lookupDNS = async (domain : string) : Promise<string> => {
    return await new Promise((resolve, reject) => {
        domain = domain.replace(/^https?:\/\//, '');
        lookup(domain, (err : ?Error, res : string) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
};

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

export async function cacheReadWrite<T>(cacheKey : string, handler : () => Promise<T>, { cache, logger } : {| cache : ?CacheType, logger : LoggerType |}) : Promise<T> {
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

let locked = false;
const MAX_LOCK_TIME = 2 * 60 * 1000;
const LOCK_FILE = join(tmpdir(), LOCK);

const acquireLock = async () => {
    locked = true;
    await writeFile(LOCK_FILE, parseInt(Date.now(), 10).toString());
};

const releaseLock = async () => {
    locked = false;
    await remove(LOCK_FILE);
};

const isLocked = async () => {
    return locked || await exists(LOCK_FILE);
};

const getLockTime = async () : Promise<number> => {
    const lock = await readFile(LOCK_FILE);
    const time = parseInt(lock.toString(), 10);
    return time;
};

export async function useFileSystemLock<T>(task : () => Promise<T>) : Promise<T> {
    const startTime = parseInt(Date.now(), 10);
    
    while (await isLocked()) {
        const time = await getLockTime();
        
        if ((startTime - time) > MAX_LOCK_TIME) {
            await releaseLock();
        } else {
            await sleep(1000);
            continue;
        }
    }

    let result;

    await acquireLock();

    try {
        result = await task();
    } catch (err) {
        await await releaseLock();
        throw err;
    }

    await releaseLock();

    return result;
}

export function sanitizeString(str : string) : string {
    return str.replace(/[^a-zA-Z0-9]+/g, '_');
}

export function clearObject<T>(obj : { [string] : T }) : void {
    for (const key of Object.keys(obj)) {
        delete obj[key];
    }
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
