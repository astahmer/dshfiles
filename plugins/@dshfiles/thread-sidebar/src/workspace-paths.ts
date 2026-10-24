// jj-integration cuts a thread workspace at `<repository>-threads/<name>`; older ones are `<repository>-<hash>`.
const THREADS_DIRECTORY_SUFFIX = '-threads'

const normalize = (path: string): string => path.replace(/\/+$/u, '')

/** The display name of a workspace checkout, accepting paths from either platform. */
export const workspaceName = (path: string): string | undefined => {
  const name = path.split(/[\\/]/u).filter(Boolean).at(-1)
  return name === '' ? undefined : name
}

/** Where a registered workspace sits relative to the project it belongs to. */
export class WorkspacePaths {
  /**
   * The project checkout a path belongs to: its repository for a jj workspace cut from it, the path itself for anything
   * else. Registered workspaces keep their project only if this says so — a jj workspace is never a project of its own.
   */
  static projectPathOf(path: string): string {
    const normalized = normalize(path)
    const separator = normalized.lastIndexOf('/')
    if (separator < 0) return normalized
    const parent = normalized.slice(0, separator)
    if (parent.length <= THREADS_DIRECTORY_SUFFIX.length || !parent.endsWith(THREADS_DIRECTORY_SUFFIX)) return normalized
    return parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)
  }

  /** A registered workspace that is a jj workspace of a project rather than a project. */
  static isJjWorkspace(path: string): boolean {
    return WorkspacePaths.projectPathOf(path) !== normalize(path)
  }

  /** The registered rows that are projects, for a project list, filter or chooser. */
  static projects<Row extends { readonly path: string }>(rows: readonly Row[]): readonly Row[] {
    return rows.filter(row => !WorkspacePaths.isJjWorkspace(row.path))
  }
}
