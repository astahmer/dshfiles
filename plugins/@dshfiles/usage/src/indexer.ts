import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { decodeFoldState, foldRecords, initialFoldState } from './fold.js'
import { readLogFrom } from './session-log.js'
import type { UsageStore } from './store.js'

/**
 * Walks `<root>/<project>/<session>/session[.vN].jsonl[.zstd]` and folds what
 * each log gained since its stored offset. Only the newest generation of a
 * session is read: an older `vN` file is an immutable copy DSH migrated from.
 * Large logs are read in slices with a yield in between, so a first index of
 * months of history never blocks the Host event loop for long.
 */

const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/
const SLICE_BYTES = 4 * 1024 * 1024

const yieldToHost = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

const listDirectories = async (path: string): Promise<string[]> =>
  (await readdir(path, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => join(path, entry.name))

const currentGeneration = async (sessionDir: string): Promise<string | undefined> => {
  let best: { readonly path: string; readonly version: number } | undefined
  for (const name of await readdir(sessionDir).catch(() => [])) {
    const match = LOG_NAME.exec(name)
    if (match === null) continue
    const version = Number(match[1] ?? 0)
    if (best === undefined || version > best.version) best = { path: join(sessionDir, name), version }
  }
  return best?.path
}

export const discoverSessionLogs = async (root: string): Promise<string[]> => {
  const logs: string[] = []
  for (const projectDir of await listDirectories(root))
    for (const sessionDir of await listDirectories(projectDir)) {
      const log = await currentGeneration(sessionDir)
      if (log !== undefined) logs.push(log)
    }
  return logs
}

export const indexSessionLog = async (store: UsageStore, path: string): Promise<number> => {
  const info = await stat(path).catch(() => undefined)
  if (info === undefined) return 0
  const cursor = store.fileCursor(path)
  if (cursor !== undefined && cursor.size === info.size && cursor.mtime_ms === info.mtimeMs) return 0
  const resumed = cursor === undefined || info.size < cursor.offset ? undefined : decodeFoldState(cursor.state)
  let state = resumed ?? initialFoldState()
  let offset = resumed === undefined || cursor === undefined ? 0 : cursor.offset
  const fallbackSessionId = basename(dirname(path))
  let rows = 0
  while (offset < info.size) {
    const window = Math.min(info.size, offset + SLICE_BYTES)
    let chunk = await readLogFrom({ path, fromOffset: offset, size: window })
    if (chunk.endOffset === offset && window < info.size) chunk = await readLogFrom({ path, fromOffset: offset, size: info.size })
    if (chunk.endOffset === offset) break
    const folded = foldRecords({ state, records: chunk.records, sessionId: fallbackSessionId })
    state = folded.state
    offset = chunk.endOffset
    store.commitLogSlice({
      path,
      sessionId: state.session?.id ?? fallbackSessionId,
      offset,
      // An unfinished pass records no size, so the next one resumes instead of skipping.
      size: offset >= info.size ? info.size : -1,
      mtimeMs: info.mtimeMs,
      state: JSON.stringify(state),
      session: state.session,
      rows: folded.rows,
    })
    rows += folded.rows.length
    await yieldToHost()
  }
  if (offset < info.size) {
    // A torn final frame: remember the file as seen, it is re-read once the writer completes it.
    store.commitLogSlice({
      path,
      sessionId: state.session?.id ?? fallbackSessionId,
      offset,
      size: info.size,
      mtimeMs: info.mtimeMs,
      state: JSON.stringify(state),
      session: state.session,
      rows: [],
    })
  }
  return rows
}

export const indexSessionLogs = async (store: UsageStore, root: string): Promise<{ readonly files: number; readonly rows: number }> => {
  const logs = await discoverSessionLogs(root)
  let rows = 0
  for (const log of logs) {
    rows += await indexSessionLog(store, log)
    await yieldToHost()
  }
  return { files: logs.length, rows }
}
