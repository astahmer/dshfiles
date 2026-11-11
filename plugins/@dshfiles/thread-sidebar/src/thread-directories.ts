/**
 * Which project a thread workspace belongs to, for plugins that group by project: the VCS providers' thread folders
 * (one page-wide read per project set) and the resolver that falls back to the `<repository>-threads` layout.
 */
export { threadSidebarThreadDirectoriesApi } from './thread-directories-api.js'
export { useThreadDirectories } from './use-thread-directories.js'
export { WorkspacePaths, type ThreadDirectories } from './workspace-paths.js'
