// The default layout VCS providers cut thread workspaces in: `<repository>-threads/<name>`. Applies to any path no
// provider reported a directory for, so attribution needs no Host round trip in the default layout.
const THREADS_DIRECTORY_SUFFIX = '-threads'

const normalize = (path: string): string => path.replace(/[\\/]+$/u, '')

/**
 * Thread directory → the project checkout whose thread workspaces it holds, as the VCS providers report it
 * (`vcs-provider-port` `threadsDirectories`). A custom `threadsDirectory` setting makes it
 * `<dir>/<repository name>`, which only the provider can map back to a repository.
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
    return input.rows.filter(row => !WorkspacePaths.isJjWorkspace({ path: row.path, threadDirectories: input.threadDirectories }))
  }
}
