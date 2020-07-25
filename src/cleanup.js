/* @flow */

import { join } from 'path';

import { readdir, stat } from 'fs-extra';

import { tryRmrf } from './util';

type CleanOptions = {|
    dir : string,
    interval : number,
    threshold : number,
    onError : ?(mixed) => void
|};

export function cleanDirectoryTask({ dir, interval, threshold, onError } : CleanOptions) : {| save : (string) => void, cancel : () => void |} {
    const savePaths = new Set();
    let timer;

    const clean = async () => {

        try {
            for (const path of await readdir(dir)) {
                const childDir = join(dir, path);

                if (savePaths.has(childDir)) {
                    continue;
                }

                const stats = await stat(childDir);
                if (stats.mtime < (Date.now() - threshold)) {
                    await tryRmrf(childDir);
                    continue;
                }
            }

        } catch (err) {
            if (onError) {
                onError(err);
            } else {
                // eslint-disable-next-line no-console
                console.error(err);
            }
        }

        timer = setTimeout(clean, interval);
    };

    timer = setTimeout(clean, interval);
    
    const save = (path) => {
        savePaths.add(path);
    };
    
    const cancel = () => {
        clearTimeout(timer);
    };

    return { save, cancel };
}
