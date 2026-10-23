import { basename, dirname, join } from 'node:path'
import type { readdir, stat } from 'node:fs/promises'
import { UsageFoldModel, type ToolSourceMetadata } from './fold.js'
import type { readLogFrom } from './session-log.js'
import type { UsageStore } from './store.js'

const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/
const SLICE_BYTES = 4 * 1024 * 1024
const EMPTY_TOOL_SOURCES: ReadonlyMap<string, ToolSourceMetadata> = new Map()

type UsageIndexFileSystem = {
  readonly readdir: typeof readdir
  readonly stat: typeof stat
}

type UsageIndexDependencies = {
  readonly fileSystem: UsageIndexFileSystem
  readonly readLogFrom: typeof readLogFrom
}

const yieldToHost = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

export const createUsageIndexService = (dependencies: UsageIndexDependencies) => {
  const listDirectories = async (path: string): Promise<string[]> =>
    (await dependencies.fileSystem.readdir(path, { withFileTypes: true }).catch(() => []))
      .filter(entry => entry.isDirectory())
      .map(entry => join(path, entry.name))

  const currentGeneration = async (sessionDir: string): Promise<string | undefined> => {
    let best: { readonly path: string; readonly version: number } | undefined
    for (const name of await dependencies.fileSystem.readdir(sessionDir).catch(() => [])) {
      const match = LOG_NAME.exec(name)
      if (match === null) continue
      const version = Number(match[1] ?? 0)
      if (best === undefined || version > best.version) best = { path: join(sessionDir, name), version }
    }
    return best?.path
  }

  const discoverSessionLogs = async ({ root }: { readonly root: string }): Promise<string[]> => {
    const logs: string[] = []
    for (const projectDir of await listDirectories(root))
      for (const sessionDir of await listDirectories(projectDir)) {
        const log = await currentGeneration(sessionDir)
        if (log !== undefined) logs.push(log)
      }
    return logs
  }

  const indexSessionLog = async ({
    store,
    path,
    toolSources = EMPTY_TOOL_SOURCES,
  }: {
    readonly store: UsageStore
    readonly path: string
    readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata>
  }): Promise<number> => {
    const info = await dependencies.fileSystem.stat(path).catch(() => undefined)
    if (info === undefined) return 0
    const cursor = store.fileCursor(path)
    if (cursor !== undefined && cursor.size === info.size && cursor.mtime_ms === info.mtimeMs) return 0
    const resumed = cursor === undefined || info.size < cursor.offset ? undefined : UsageFoldModel.decodeFoldState(cursor.state)
    let state = resumed ?? UsageFoldModel.initialFoldState()
    let offset = resumed === undefined || cursor === undefined ? 0 : cursor.offset
    const fallbackSessionId = basename(dirname(path))
    let rows = 0
    while (offset < info.size) {
      const window = Math.min(info.size, offset + SLICE_BYTES)
      let chunk = await dependencies.readLogFrom({ path, fromOffset: offset, size: window })
      if (chunk.endOffset === offset && window < info.size) chunk = await dependencies.readLogFrom({ path, fromOffset: offset, size: info.size })
      if (chunk.endOffset === offset) break
      const folded = UsageFoldModel.foldRecords({
        state,
        records: chunk.records,
        sessionId: fallbackSessionId,
        toolSources,
      })
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
        tools: folded.tools,
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
        tools: [],
      })
    }
    return rows
  }

  const indexSessionLogs = async ({
    store,
    root,
    toolSources = EMPTY_TOOL_SOURCES,
  }: {
    readonly store: UsageStore
    readonly root: string
    readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata>
  }): Promise<{ readonly files: number; readonly rows: number }> => {
    const logs = await discoverSessionLogs({ root })
    let rows = 0
    for (const path of logs) {
      rows += await indexSessionLog({
        store,
        path,
        toolSources,
      })
      await yieldToHost()
    }
    return { files: logs.length, rows }
  }

  return { discoverSessionLogs, indexSessionLog, indexSessionLogs }
}
