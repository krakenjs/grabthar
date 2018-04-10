/* @flow */

import childProcess from 'child_process';

import yargsParser from 'yargs-parser';

import { nextTick } from './util';

let mockChildProcessExec;

let childProcessExec = childProcess.exec;

// $FlowFixMe
childProcess.exec = (...args) => {
    return mockChildProcessExec ? mockChildProcessExec(...args) : childProcessExec(...args);
};

export type MockCmd = {
    args : Array<string>,
    opts : {
        [string] : string
    }
};

type MockExecNext = {
    cmd : MockCmd,
    opts : ?Object,
    res : (string) => Promise<void>,
    err : (string) => Promise<void>
};

type MockExec = {
    next : () => Promise<MockExecNext>,
    cancel : () => void
};

export function mockExec() : MockExec {
    let buffer : Array<MockExecNext> = [];
    let nextResolve;
    mockChildProcessExec = (command, opts, callback) => {
        let { _ : args, ...options } = yargsParser(command);
        let cmd = { args, opts: options };

        let res = async (text) => {
            if (!callback) {
                throw new Error(`Expected callback to be passed`);
            }
            callback(null, text, '');
            await nextTick();
        };

        let err = async (message) => {
            if (!callback) {
                throw new Error(`Expected callback to be passed`);
            }
            callback(null, '', message);
            await nextTick();
        };

        buffer.push({ cmd, opts, res, err });

        if (nextResolve) {
            nextResolve(buffer.shift());
        }
    };
    return {
        async next() : Promise<MockExecNext> {
            if (buffer.length) {
                return await buffer.shift();
            }
            return new Promise((resolve, reject) => {
                nextResolve = resolve;
                let err = new Error(`No new commands in 1000ms`);
                setTimeout(() => reject(err), 1000);
            });
        },
        cancel() {
            mockChildProcessExec = null;
        }
    };
}
