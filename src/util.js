/* @flow */

import { join } from 'path';
import { homedir } from 'os';

import { mkdir, exists } from 'fs-extra';
import { exec } from 'npm-run';

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

export function poll<T : mixed>({ handler, onError, period, multiplier = 2 } : { handler : () => Promise<T> | T, onError? : (Error) => void, period : number, multiplier? : number }) : Poller<T> {

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

export async function npmRun(command : string, options : Object) : Promise<string> {
    return await new Promise((resolve, reject) => {
        exec(command, options, (err, stdout, stderr) => {
            if (err) {
                return reject(err);
            }

            if (stderr) {
                return reject(new Error(stderr.toString()));
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
