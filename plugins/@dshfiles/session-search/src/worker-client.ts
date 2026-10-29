/**
 * Host half of the worker protocol. It spawns the index worker, keeps request/response correlation, and restarts the
 * worker after a crash. Every call here is asynchronous and cheap: no decode, no parse, no SQLite work happens on the
 * Host's thread.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import { withoutUndefined } from './optional-fields.js'
import {
  searchEventsResultSchema,
  searchSessionsResultSchema,
  indexHealthSchema,
  workerReplySchema,
  type IndexHealth,
  type JsonValue,
  type SearchEventsResult,
  type SearchSessionsResult,
  type SessionEventSearchRequest,
  type SessionSearchRequest,
  type WorkerRequestInput,
} from './protocol.js'

export class SearchWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SearchWorkerError'
  }
}

export interface WorkerEntry {
  readonly url: URL
  readonly execArgv: readonly string[]
}

export interface SearchWorkerClientOptions {
  readonly indexPath: string
  readonly windowBytes?: number
  readonly requestTimeoutMs?: number
  readonly onProgress?: (health: IndexHealth) => void
  readonly onError?: (error: SearchWorkerError) => void
  readonly workerUrl?: URL
  readonly execArgv?: readonly string[]
}

interface PendingRequest {
  readonly resolve: (value: JsonValue) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Resolve the worker entry. A built plugin loads its sibling `dist/search-worker.js`; a source run (tests, `dshx dev`)
 * falls back to the worker built next to the package. Node cannot resolve `.js` specifiers inside a `.ts` module, so the
 * built file is the supported path — build the plugin before testing.
 */
const resolveWorkerEntry = (base: string | URL): WorkerEntry => {
  const root = base instanceof URL ? base : new URL(base)
  for (const candidate of [new URL('./search-worker.js', root), new URL('../dist/search-worker.js', root)]) {
    if (existsSync(fileURLToPath(candidate))) return { url: candidate, execArgv: [] }
  }
  return { url: new URL('./search-worker.ts', root), execArgv: ['--experimental-strip-types'] }
}

export class SearchWorkerClient {
  readonly #options: SearchWorkerClientOptions
  #worker: Worker | undefined
  #nextId = 1
  #pending = new Map<number, PendingRequest>()
  #health: IndexHealth | undefined
  #closed = false

  constructor(options: SearchWorkerClientOptions) {
    this.#options = options
  }

  get healthSnapshot(): IndexHealth | undefined {
    return this.#health
  }

  #ensureWorker(): Worker {
    if (this.#closed) throw new SearchWorkerError('session-search-worker-closed', 'The session-search worker is closed.')
    if (this.#worker !== undefined) return this.#worker
    const entry = this.#options.workerUrl === undefined ? resolveWorkerEntry(import.meta.url) : { url: this.#options.workerUrl, execArgv: [] }
    const execArgv = this.#options.execArgv ?? entry.execArgv
    const worker = new Worker(
      entry.url,
      withoutUndefined({
        workerData: { indexPath: this.#options.indexPath, windowBytes: this.#options.windowBytes },
        execArgv: execArgv.length === 0 ? undefined : [...execArgv],
      }),
    )
    worker.on('message', raw => this.#onMessage(raw))
    worker.on('error', error => this.#onFailure(new SearchWorkerError('session-search-worker-failed', error.message)))
    worker.on('exit', code => {
      if (this.#closed || code === 0) return
      this.#onFailure(new SearchWorkerError('session-search-worker-exited', `The session-search worker exited with code ${String(code)}.`))
    })
    this.#worker = worker
    return worker
  }

  #onMessage(raw: JsonValue): void {
    const parsed = workerReplySchema.safeParse(raw)
    if (!parsed.success) return
    const reply = parsed.data
    if (!('id' in reply)) {
      this.#health = reply.health
      this.#options.onProgress?.(reply.health)
      return
    }
    const pending = this.#pending.get(reply.id)
    if (pending === undefined) return
    this.#pending.delete(reply.id)
    clearTimeout(pending.timer)
    if (reply.ok) pending.resolve(reply.value)
    else pending.reject(new SearchWorkerError(reply.code, reply.message))
  }

  #onFailure(error: SearchWorkerError): void {
    this.#options.onError?.(error)
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const request of pending) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.#worker = undefined
  }

  #send<Result>(request: WorkerRequestInput, schema: z.ZodType<Result>): Promise<Result> {
    const worker = this.#ensureWorker()
    const id = this.#nextId
    this.#nextId += 1
    const timeoutMs = this.#options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    const answer = new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new SearchWorkerError('session-search-worker-timeout', `The session-search worker did not answer within ${String(timeoutMs)} ms.`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      worker.postMessage({ ...request, id })
    })
    return answer.then(value => schema.parse(value))
  }

  async searchSessions(request: SessionSearchRequest): Promise<SearchSessionsResult> {
    return this.#send({ kind: 'search-sessions', request }, searchSessionsResultSchema)
  }

  async searchEvents(request: SessionEventSearchRequest): Promise<SearchEventsResult> {
    return this.#send({ kind: 'search-events', request }, searchEventsResultSchema)
  }

  async health(): Promise<IndexHealth> {
    const value = await this.#send({ kind: 'health' }, indexHealthSchema)
    this.#health = value
    return value
  }

  /** Wake the ingest loop now, for example after a Session event was committed. */
  async nudge(): Promise<IndexHealth> {
    const value = await this.#send({ kind: 'nudge' }, indexHealthSchema)
    this.#health = value
    return value
  }

  async startIngest(root: string): Promise<IndexHealth> {
    return this.#send({ kind: 'ingest', root }, indexHealthSchema)
  }

  async close(): Promise<void> {
    this.#closed = true
    const worker = this.#worker
    this.#worker = undefined
    if (worker === undefined) return
    this.#onFailure(new SearchWorkerError('session-search-worker-closed', 'The session-search worker is closed.'))
    try {
      worker.postMessage({ kind: 'close', id: 0 })
      await worker.terminate()
    } catch {
      // A worker already gone needs no further teardown.
    }
  }
}
