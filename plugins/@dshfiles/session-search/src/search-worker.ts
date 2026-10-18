/**
 * The worker entry point. It owns the FTS5 index and every byte of decode, parse, and insert work, so the Host event
 * loop never performs index maintenance — not during a first full build and not during an ordinary search.
 *
 * Requests arrive over `parentPort`; the ingest loop runs between messages and yields to them, which is what keeps a
 * search answerable while the corpus is still being indexed.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { SearchIndex } from './index-db.js'
import { runIngestPass } from './ingest.js'
import type { JsonValue } from './protocol.js'
import { workerRequestSchema, type IndexHealth, type WorkerReply } from './protocol.js'

const workerConfigSchema = z.object({ indexPath: z.string().min(1), windowBytes: z.number().int().positive().default(16 * 1024 * 1024) })
const config = workerConfigSchema.parse(workerData)

const IDLE_SLEEP_MS = 5_000
const BUSY_SLEEP_MS = 50

interface WorkerState {
  index: SearchIndex | undefined
  root: string | undefined
  ingesting: boolean
  stopped: boolean
  lastIngestMs: number
  lastError: string | null
  behindSessions: number
  behindBytes: number
}

const state: WorkerState = { index: undefined, root: undefined, ingesting: false, stopped: false, lastIngestMs: 0, lastError: null, behindSessions: 0, behindBytes: 0 }

const requireIndex = (): SearchIndex => {
  state.index ??= new SearchIndex(config.indexPath)
  return state.index
}

const health = (): IndexHealth =>
  requireIndex().health({
    behindSessions: state.behindSessions,
    behindBytes: state.behindBytes,
    ingesting: state.ingesting,
    lastIngestMs: state.lastIngestMs,
    lastError: state.lastError,
  })

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500)

let wake: (() => void) | undefined

/** Sleep that a committed session event can cut short, so fresh content is searchable without waiting out the idle delay. */
const wait = (ms: number): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(() => {
      wake = undefined
      resolve()
    }, ms)
    wake = () => {
      clearTimeout(timer)
      wake = undefined
      resolve()
    }
  })

let ingestRunning = false

const startIngest = (): void => {
  if (ingestRunning || state.root === undefined) return
  ingestRunning = true
  void (async () => {
    while (!state.stopped) {
      const root = state.root
      if (root === undefined) break
      const startedAt = Date.now()
      state.ingesting = true
      try {
        const result = await runIngestPass({ index: requireIndex(), root, budgetMs: 1_000, windowBytes: config.windowBytes, now: Date.now })
        state.behindSessions = result.behindSessions
        state.behindBytes = result.behindBytes
        state.lastError = null
        state.lastIngestMs = Date.now() - startedAt
        parentPort?.postMessage({ kind: 'progress', health: health() } satisfies WorkerReply)
        await wait(result.complete && result.ingested === 0 ? IDLE_SLEEP_MS : BUSY_SLEEP_MS)
      } catch (error) {
        state.lastError = describe(error)
        state.lastIngestMs = Date.now() - startedAt
        parentPort?.postMessage({ kind: 'progress', health: health() } satisfies WorkerReply)
        await wait(IDLE_SLEEP_MS)
      } finally {
        state.ingesting = false
      }
    }
    ingestRunning = false
  })()
}

const respond = <Value>(id: number, operation: () => Value): void => {
  try {
    // SAFETY: every answer this worker sends is a JSON-shaped value (health counters or schema-decoded rows); the port serializes it with JSON.
    parentPort?.postMessage({ id, ok: true, value: operation() as JsonValue } satisfies WorkerReply)
  } catch (error) {
    parentPort?.postMessage({ id, ok: false, code: 'session-search-index-failed', message: describe(error) } satisfies WorkerReply)
  }
}

parentPort?.on('message', raw => {
  const parsed = workerRequestSchema.safeParse(raw)
  if (!parsed.success) return
  const request = parsed.data
  if (request.kind === 'close') {
    state.stopped = true
    state.index?.close()
    state.index = undefined
    process.exit(0)
  }
  if (request.kind === 'nudge') {
    wake?.()
    respond(request.id, () => health())
    return
  }
  if (request.kind === 'health') {
    respond(request.id, () => health())
    return
  }
  if (request.kind === 'ingest') {
    state.root = request.root
    startIngest()
    respond(request.id, () => health())
    return
  }
  if (request.kind === 'search-sessions') {
    respond(request.id, () => requireIndex().searchSessions(request.request))
    return
  }
  respond(request.id, () => ({ sessionId: request.request.sessionId, ...requireIndex().searchEvents(request.request) }))
})
