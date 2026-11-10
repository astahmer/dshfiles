/**
 * A cheap change signal for the JSONL Session store (`<root>/<project>/<session>/…`), so the cached list corpus notices
 * a Session another process stored without re-reading every header: a new Session directory moves its project
 * directory's modification time, and a new project adds a name under the root.
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Modification time of each project directory under the store root, by directory name. */
export type ProjectStamps = ReadonlyMap<string, number>

/** The storage root of a persistence backend that keeps one directory per project, or `undefined` for any other. */
export const corpusRootOf = (persistence: unknown): string | undefined =>
  typeof persistence === 'object' && persistence !== null && 'root' in persistence && typeof persistence.root === 'string'
    ? persistence.root
    : undefined

const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT'

/**
 * The project directories under `root` with their modification times. A root not created yet (a new home) has none;
 * `undefined` when it cannot be read.
 */
export const readProjectStamps = async (root: string): Promise<ProjectStamps | undefined> => {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const projects = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    // A project removed between the two reads is simply absent.
    const stamps = await Promise.all(projects.map(name => stat(join(root, name)).then(stats => [[name, stats.mtimeMs] as const], () => [])))
    return new Map(stamps.flat())
  } catch (error) {
    return isMissing(error) ? new Map() : undefined
  }
}

/** Project directories that appeared or whose modification time moved since `previous`. */
export const changedProjects = ({ previous, next }: { previous: ProjectStamps; next: ProjectStamps }): string[] =>
  [...next].filter(([name, mtime]) => previous.get(name) !== mtime).map(([name]) => name)

/** Reverses the backend's path-segment encoding: unsafe code units are written `~XXXX`. */
const decodeSegment = (segment: string): string =>
  segment.replace(/~([0-9A-F]{4})/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))

/** Session ids stored in one project directory; dot-prefixed names are the backend's staging directories. */
export const storedSessionIds = async (projectDir: string): Promise<string[]> => {
  const entries = await readdir(projectDir, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => decodeSegment(entry.name))
}
