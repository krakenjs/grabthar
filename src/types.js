/* @flow */

export type LoggerType = {|
  +debug: Function,
  +info: Function,
  +warn: Function,
  +error: Function,
|};

export type CacheType = {|
  get: <T>(string) => Promise<T | void>, // eslint-disable-line no-undef
  set: <T>(string, T) => Promise<T>, // eslint-disable-line no-undef
|};
