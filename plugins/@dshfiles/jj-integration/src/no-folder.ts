/**
 * The scratch workspace every "No folder" thread starts in. Shared with the thread sidebar, which offers to promote
 * one into a project, so both halves agree on the folder marker and on the title a scratch workspace still carries.
 */

/** The Home-relative marker every scratch folder is under: `~/.dsh/no-folder` and one dated child per thread. */
const PATH_MARKER = '/.dsh/no-folder'

/** The title a scratch workspace carries until it is turned into a project. */
const WORKSPACE_TITLE = 'No folder'

const asPosix = (candidate: string): string => candidate.replaceAll('\\', '/').replace(/\/+$/u, '')

/** Whether a folder is the no-folder root itself or a per-thread scratch folder under it. */
const isPath = (candidate: string | undefined): boolean => {
  if (candidate === undefined || candidate.length === 0) return false
  const normalized = asPosix(candidate)
  return normalized.endsWith(PATH_MARKER) || normalized.includes(`${PATH_MARKER}/`)
}

/** Whether a registered workspace is still a scratch thread: in a scratch folder and still under the scratch title. */
const isScratchWorkspace = (workspace: { readonly path: string; readonly title: string }): boolean =>
  isPath(workspace.path) && workspace.title === WORKSPACE_TITLE

/**
 * The scratch folder a new No folder thread takes over instead of adding another one: a registered, still present
 * per-thread folder with no Session accounted to it. The shared root is never reused, so the threads that already
 * live there keep their own folder.
 */
const reusablePath = (input: {
  readonly root: string
  readonly workspaces: readonly { readonly path: string; readonly sessionIds: readonly string[] }[]
  readonly presentPaths: ReadonlySet<string>
}): string | undefined =>
  input.workspaces.find(
    workspace => workspace.path !== input.root && isPath(workspace.path) && workspace.sessionIds.length === 0 && input.presentPaths.has(workspace.path),
  )?.path

/** The no-folder scratch layout: its folder marker, the title a scratch workspace keeps, and which folder a new one reuses. */
export class NoFolderWorkspace {
  static readonly pathMarker = PATH_MARKER
  static readonly workspaceTitle = WORKSPACE_TITLE
  static readonly isPath = isPath
  static readonly isScratchWorkspace = isScratchWorkspace
  static readonly reusablePath = reusablePath
}
