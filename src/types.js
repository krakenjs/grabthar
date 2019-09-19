/* @flow */

export type LoggerType = {|
    +debug : Function,
    +info : Function,
    +warn : Function,
    +error : Function
|};

export type CacheType = {|
    get : (string) => Promise<string | void>,
    set : (string, string) => Promise<string>
|};
