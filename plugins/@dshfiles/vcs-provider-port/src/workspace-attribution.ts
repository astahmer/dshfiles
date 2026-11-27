// The default layout VCS providers cut thread workspaces in: `<repository>-threads/<name>`. Applies to any path no
// provider reported a directory for, so attribution needs no Host round trip in the default layout.
const THREADS_DIRECTORY_SUFFIX = '-threads'

const normalize = (path: string): string => path.replace(/[\\/]+$/u, '')

/**
 * Thread directory → the project checkout whose thread workspaces it holds, as the VCS providers report it
 * (`VcsProviders.threadsDirectories`). A custom `threadsDirectory` setting makes it `<dir>/<repository name>`, which
 * only the provider can map back to a repository.
 */
export type ThreadDirectories = ReadonlyMap<string, string>

const NO_THREAD_DIRECTORIES: ThreadDirectories = new Map()

interface ReportedThreadsDirectory {
  readonly repoRoot: string
  readonly threadsDirectory: string
}

/** The display name of a workspace checkout, accepting paths from either platform. */
export const workspaceName = (path: string): string | undefined => {
  const name = path.split(/[\\/]/u).filter(Boolean).at(-1)
  return name === '' ? undefined : name
}

/** Where a registered workspace sits relative to the project it belongs to. */
export class WorkspacePaths {
  static threadDirectoriesOf(reported: readonly ReportedThreadsDirectory[]): ThreadDirectories {
    return new Map(reported.map(entry => [normalize(entry.threadsDirectory), normalize(entry.repoRoot)]))
  }

  /**
   * The project checkout a path belongs to: its repository for a thread workspace cut from it, the path itself for
   * anything else. Registered workspaces keep their project only if this says so — a thread workspace is never a
   * project of its own. A directory a provider reported wins; otherwise the `<repository>-threads` layout applies.
   */
  static projectPathOf(input: { readonly path: string; readonly threadDirectories?: ThreadDirectories | undefined }): string {
    const normalized = normalize(input.path)
    const separator = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
    if (separator < 0) return normalized
    const parent = normalized.slice(0, separator)
    const reported = (input.threadDirectories ?? NO_THREAD_DIRECTORIES).get(parent)
    if (reported !== undefined && reported !== normalized) return reported
    if (parent.length <= THREADS_DIRECTORY_SUFFIX.length || !parent.endsWith(THREADS_DIRECTORY_SUFFIX)) return normalized
    return parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)
  }

  /** A registered workspace that is a thread workspace of a project rather than a project. */
  static isJjWorkspace(input: { readonly path: string; readonly threadDirectories?: ThreadDirectories | undefined }): boolean {
    return WorkspacePaths.projectPathOf(input) !== normalize(input.path)
  }

  /** The registered rows that are projects, for a project list, filter or chooser. */
  static projects<Row extends { readonly path: string }>(input: {
    readonly rows: readonly Row[]
    readonly threadDirectories?: ThreadDirectories | undefined
  }): readonly Row[] {
    return input.rows.filter(
      row =>
        !WorkspacePaths.isJjWorkspace({
          path: row.path,
          threadDirectories: input.threadDirectories,
        }),
    )
  }
}

/** The workspace fields session attribution reads; the Host workspace registry and the client stream both carry them. */
export interface AttributedWorkspace {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

interface PathIndex<Workspace extends AttributedWorkspace> {
  readonly byPath: ReadonlyMap<string, Workspace>
  readonly threadDirectories: ThreadDirectories | undefined
}

const indexOf = <Workspace extends AttributedWorkspace>(
  workspaces: readonly Workspace[],
  threadDirectories: ThreadDirectories | undefined,
): PathIndex<Workspace> => ({
  byPath: new Map(workspaces.map(workspace => [workspace.path, workspace])),
  threadDirectories,
})

const projectOfThreadWorkspace = <Workspace extends AttributedWorkspace>(workspace: Workspace, index: PathIndex<Workspace>): Workspace | undefined => {
  const projectPath = WorkspacePaths.projectPathOf({
    path: workspace.path,
    threadDirectories: index.threadDirectories,
  })
  return projectPath === workspace.path ? undefined : index.byPath.get(projectPath)
}

/**
 * The owning project of a filesystem path. A registered thread workspace resolves to the repository it builds in; a
 * path under a `<repository>-threads` directory resolves even without a registration, which is all a session keeps
 * after its thread workspace is forgotten.
 */
const projectIdForPath = (path: string, index: PathIndex<AttributedWorkspace>): string | undefined => {
  const registered = index.byPath.get(path)
  if (registered !== undefined) return (projectOfThreadWorkspace(registered, index) ?? registered).workspaceId
  const projectPath = WorkspacePaths.projectPathOf({
    path,
    threadDirectories: index.threadDirectories,
  })
  if (projectPath === path) return undefined
  const owner = index.byPath.get(projectPath)
  return owner === undefined ? undefined : (projectOfThreadWorkspace(owner, index) ?? owner).workspaceId
}

/**
 * Which DSH project (registered project workspace) each Session belongs to. Thread workspaces are attributed to their
 * owning project workspace; unaccounted sessions fall back to their recorded cwd. `threadDirectories` carries the VCS
 * providers' custom thread folders; without it the default `<repository>-threads` layout applies.
 */
const workspaceForSessions = (input: {
  readonly workspaces: readonly AttributedWorkspace[]
  readonly sessions: readonly {
    readonly id: string
    readonly cwd?: string | undefined
  }[]
  readonly threadDirectories?: ThreadDirectories | undefined
}): Map<string, string> => {
  const index = indexOf(input.workspaces, input.threadDirectories)
  const map = new Map<string, string>()
  for (const workspace of input.workspaces) {
    const owner = projectOfThreadWorkspace(workspace, index) ?? workspace
    for (const sessionId of workspace.sessionIds) map.set(sessionId, owner.workspaceId)
  }
  for (const session of input.sessions) {
    if (map.has(session.id) || session.cwd === undefined) continue
    const projectId = projectIdForPath(session.cwd, index)
    if (projectId !== undefined) map.set(session.id, projectId)
  }
  return map
}

/** The project of one Session, by the same rules as {@link workspaceForSessions}; undefined when none owns it. */
const projectOfSession = (input: {
  readonly workspaces: readonly AttributedWorkspace[]
  readonly sessionId: string
  readonly cwd?: string | undefined
  readonly threadDirectories?: ThreadDirectories | undefined
}): string | undefined =>
  workspaceForSessions({
    workspaces: input.workspaces,
    sessions: [{ id: input.sessionId, cwd: input.cwd }],
    threadDirectories: input.threadDirectories,
  }).get(input.sessionId)

/**
 * Session → project attribution, shared by every plugin that groups or configures by project (thread-sidebar's
 * project grouping, agents' project default agent). Pure: the caller passes the workspace registry rows.
 */
export class WorkspaceAttribution {
  static readonly workspaceForSessions = workspaceForSessions
  static readonly projectOfSession = projectOfSession
}
