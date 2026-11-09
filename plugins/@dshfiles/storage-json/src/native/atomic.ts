/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @returns resolution after the replacement is crash-durable.
 */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceFile(tmp, path)
    await fsyncDirectory(dirname(path))
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

const isTransientLock = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY')

/**
 * Windows fails the replacing rename with EPERM, EACCES or EBUSY while another process (antivirus, the search indexer,
 * a sync client or editor) holds the target open without FILE_SHARE_DELETE; those holds are brief, so retry there with
 * a short backoff, as graceful-fs does. POSIX renames never fail that way.
 */
async function replaceFile(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (process.platform !== 'win32' || attempt >= 10 || !isTransientLock(error)) throw error
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20 * (attempt + 1)))
    }
  }
}

/** fsync a POSIX directory so a just-renamed entry is crash-durable. */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */
