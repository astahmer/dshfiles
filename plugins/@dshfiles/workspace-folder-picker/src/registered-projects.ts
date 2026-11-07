/** A registered workspace as the project list shows it: the Host's own id, title and canonical path. */
export interface RegisteredProjectSource {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

// jj-integration cuts a thread workspace at `<repository>-threads/<name>`; older ones are `thread-<hash>`.
const THREADS_DIRECTORY_SUFFIX = '-threads'
const THREAD_WORKSPACE_NAME = /^thread-[0-9a-f]{6}$/u

const segments = (path: string): readonly string[] => path.replace(/\/+$/u, '').split('/')

const belongsToThreadsDirectory = (name: string | undefined): boolean =>
  name !== undefined && name.length > THREADS_DIRECTORY_SUFFIX.length && name.endsWith(THREADS_DIRECTORY_SUFFIX)

/** A jj workspace a project was cut from: it belongs to that project and is never a project of its own. */
export const isThreadWorkspacePath = (path: string): boolean => {
  const parts = segments(path)
  return THREAD_WORKSPACE_NAME.test(parts.at(-1) ?? '') || belongsToThreadsDirectory(parts.at(-2))
}

export const registeredProjects = (workspaces: readonly RegisteredProjectSource[]): readonly RegisteredProjectSource[] =>
  workspaces.filter(workspace => !isThreadWorkspacePath(workspace.path))
