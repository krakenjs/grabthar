/* @flow */

export {
  npmPoll as poll,
  getFallback as getVersionFromNodeModules,
  importDependency,
  importParent,
  getFile,
} from "./poll";
export { installVersion } from "./npm";
