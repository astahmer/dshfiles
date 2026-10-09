import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type WorkspaceWriteErrorCode = 'invalid-path' | 'outside-workspace' | 'missing-parent' | 'not-regular-file' | 'too-large' | 'protected-path'

export class WorkspaceWriteError extends Error {
  readonly code: WorkspaceWriteErrorCode
  constructor(code: WorkspaceWriteErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceWriteError'
    this.code = code
  }
}

export interface WorkspaceWriteRequest {
  readonly root: string
  readonly path: string
  readonly text: string
  readonly expectedSha256: string | null
  readonly overwrite: boolean
  readonly maxBytes: number
}

export type WorkspaceWriteResult =
  | { readonly status: 'saved'; readonly absolutePath: string; readonly sha256: string; readonly bytes: number }
  | { readonly status: 'conflict'; readonly currentSha256: string | null }

const PROTECTED_SEGMENTS = new Set(['.git', '.jj'])

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const isInside = (root: string, target: string): boolean => {
  const fromRoot = relative(root, target)
  return fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith('..' + sep) && !isAbsolute(fromRoot)
}

const realDirectory = async (path: string): Promise<string | undefined> => {
  try {
    return await realpath(path)
  } catch {
    return undefined
  }
}

const existingEntry = async (path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> => {
  try {
    return await lstat(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Replace (or create) one text file inside a workspace root. The parent directory is resolved through its real path
 * so a symlinked directory cannot carry the write outside the root; the target itself must be a regular file, never a
 * symlink. The content lands in an exclusive temp sibling, is fsynced, then renamed over the target, so readers see
 * the old or the new file, never a mix. `expectedSha256` is the hash of what the editor loaded: a different file on
 * disk is reported as a conflict unless `overwrite` is set.
 */
export const writeWorkspaceFile = async (request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult> => {
  if (request.path.includes('\0')) throw new WorkspaceWriteError('invalid-path', 'Path contains a NUL byte.')
  const content = Buffer.from(request.text, 'utf8')
  if (content.byteLength > request.maxBytes) throw new WorkspaceWriteError('too-large', `File exceeds the ${request.maxBytes} byte save limit.`)
  const root = await realDirectory(request.root)
  if (root === undefined) throw new WorkspaceWriteError('missing-parent', 'Workspace root is unavailable.')
  const requested = isAbsolute(request.path) ? resolve(request.path) : resolve(root, request.path)
  const name = basename(requested)
  if (name === '' || name === '.' || name === '..') throw new WorkspaceWriteError('invalid-path', 'Path does not name a file.')
  const parent = await realDirectory(dirname(requested))
  if (parent === undefined) throw new WorkspaceWriteError('missing-parent', 'Parent directory does not exist.')
  const target = join(parent, name)
  if (!isInside(root, target)) throw new WorkspaceWriteError('outside-workspace', 'Path is outside the session workspace.')
  if (
    relative(root, target)
      .split(sep)
      .some(segment => PROTECTED_SEGMENTS.has(segment))
  ) {
    throw new WorkspaceWriteError('protected-path', 'Version-control internals are not editable.')
  }

  const entry = await existingEntry(target)
  if (entry !== undefined && !entry.isFile())
    throw new WorkspaceWriteError('not-regular-file', 'Only regular files can be saved; symlinks and directories are refused.')
  const currentSha256 = entry === undefined ? null : sha256Hex(await readFile(target))
  if (!request.overwrite && currentSha256 !== request.expectedSha256) return { status: 'conflict', currentSha256 }

  const temporary = join(parent, `.${name}.${randomUUID()}.dshfiles-tmp`)
  const handle = await open(temporary, 'wx', entry === undefined ? 0o644 : Number(entry.mode) & 0o7777)
  try {
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    if ((await realDirectory(dirname(requested))) !== parent) throw new WorkspaceWriteError('outside-workspace', 'Parent directory changed during the save.')
    await rename(temporary, target)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return { status: 'saved', absolutePath: target, sha256: sha256Hex(content), bytes: content.byteLength }
}
