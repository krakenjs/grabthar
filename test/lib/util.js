/* @flow */

export async function wrapPromise<T : mixed>(handler : (reject : (reason : ?mixed) => void) => Promise<T>) : Promise<T> {
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
