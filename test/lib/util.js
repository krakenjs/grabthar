/* @flow */

export async function wrapPromise<T : mixed>(handler : (reject : (reason : ?mixed) => void) => Promise<T>) : Promise<T> {
    // eslint-disable-next-line no-async-promise-executor
    return await new Promise(async (resolve, reject) => {
        let result;
        try {
            result = await handler(err => {
                reject(err);
            });
        } catch (err) {
            return reject(err);
        }
        return resolve(result);
    });
}

export async function nextTick() : Promise<void> {
    return await new Promise(resolve => process.nextTick(resolve));
}

export function entries<T>(obj : { [string] : T }) : $ReadOnlyArray<[ string, T ]> {
    // $FlowFixMe
    return Object.entries(obj);
}
