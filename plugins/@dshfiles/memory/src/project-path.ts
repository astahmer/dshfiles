import { realpath, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

/** Secondary JJ workspaces point at the owning checkout's store; memory should use that project path. */
const jjProjectRootAt = async (workspaceRoot: string): Promise<string | undefined> => {
  const pointerPath = join(workspaceRoot, '.jj', 'repo')
  const metadata = await stat(pointerPath).catch(() => undefined)
  if (metadata?.isDirectory()) return workspaceRoot
  if (metadata?.isFile() !== true || metadata.size > 4_096) return undefined

  const pointer = (await readFile(pointerPath, 'utf8').catch(() => '')).trim()
  if (pointer.length === 0) return undefined

  const storePath = resolve(dirname(pointerPath), pointer)
  if (basename(storePath) !== 'repo' || basename(dirname(storePath)) !== '.jj') return undefined
  const store = await stat(storePath).catch(() => undefined)
  if (store?.isDirectory() !== true) return undefined

  return dirname(dirname(storePath))
}

const findJjProjectRoot = async (path: string): Promise<string | undefined> => {
  let directory = path
  while (true) {
    const projectRoot = await jjProjectRootAt(directory)
    if (projectRoot !== undefined) return projectRoot

    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

export const projectPathFor = async (cwd: string): Promise<string> => {
  const canonicalPath = await realpath(cwd).catch(() => resolve(cwd))
  const projectRoot = await findJjProjectRoot(canonicalPath)
  if (projectRoot === undefined) return canonicalPath
  return realpath(projectRoot).catch(() => resolve(projectRoot))
}
