/* @flow */

import childProcess from 'child_process';

import yargsParser from 'yargs-parser';

import { nextTick } from './util';

let mockChildProcessExec;

const childProcessExec = childProcess.exec;

// $FlowFixMe
childProcess.exec = (...args) => {
    return mockChildProcessExec ? mockChildProcessExec(...args) : childProcessExec(...args);
};

export type MockCmd = {|
    args : $ReadOnlyArray<string>,
    opts : {
        [string] : string
    }
|};

type MockExecNext = {|
    cmd : MockCmd,
    opts : ?Object,
    res : (string) => Promise<void>,
    err : (string) => Promise<void>
|};

type MockExec = {|
    next : () => Promise<MockExecNext>,
    cancel : () => void
|};

const MOCK_EXEC_TIMEOUT = 1000;

export function mockExec() : MockExec {
    const buffer : Array<MockExecNext> = [];
    let nextResolve;
    mockChildProcessExec = (command, opts, callback) => {
        const { _ : args, ...options } = yargsParser(command);
        const cmd = { args, opts: options };

        const res = async (text) => {
            if (!callback) {
                throw new Error(`Expected callback to be passed`);
            }
            callback(null, text, '');
            await nextTick();
        };

        const err = async (message) => {
            if (!callback) {
                throw new Error(`Expected callback to be passed`);
            }
            callback(null, '', message);
            await nextTick();
        };

        buffer.push({ cmd, opts, res, err });

        if (nextResolve) {
            nextResolve(buffer.shift());
            nextResolve = null;
        }
    };
    return {
        async next() : Promise<MockExecNext> {
            if (buffer.length) {
                return await buffer.shift();
            }
            return new Promise((resolve, reject) => {
                nextResolve = resolve;
                const err = new Error(`No new commands in ${ MOCK_EXEC_TIMEOUT }ms`);
                setTimeout(() => reject(err), MOCK_EXEC_TIMEOUT);
            });
        },
        cancel() {
            mockChildProcessExec = null;
        }
    };
}
