import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Small owner-only JSON state files, written atomically and never read-modify-written concurrently. */
export class JsonFile {
  static readonly readText = async ({ path, missing }: { readonly path: string; readonly missing: string }): Promise<string> =>
    readFile(path, 'utf8').catch(error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return missing
      throw error
    })

  static readonly write = async ({ path, text }: { readonly path: string; readonly text: string }): Promise<void> => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporaryPath, path)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  /** Serialize every read-modify-write of one file, so two callers never interleave. */
  static readonly transaction = (): (<Value>(operation: () => Promise<Value>) => Promise<Value>) => {
    let queue: Promise<unknown> = Promise.resolve()
    return <Value>(operation: () => Promise<Value>): Promise<Value> => {
      const next = queue.then(operation, operation)
      queue = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    }
  }
}
