import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  activityIngestSchema,
  activityStateSchema,
  type ActivityEvent,
  type ActivityFilter,
  type ActivityIngest,
  type ActivityPage,
  type ActivityState,
} from './types.js'
import { ActivityTimelineCondensation } from './condensation.js'

const MAX_EVENTS = 5000
const DEFAULT_PAGE = 60
/** A cached snapshot older than this is re-read even when the file's metadata looks unchanged. */
const STATE_FRESHNESS_MS = 30_000
/** Buffered events flush within this delay, so an acknowledgement is delayed but never dropped. */
const INGEST_BATCH_DELAY_MS = 25
/** A burst this large flushes immediately instead of growing the buffer. */
const INGEST_BATCH_LIMIT = 200

export class ActivityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ActivityError'
  }
}

export interface ActivityTimelineServiceOptions {
  readonly statePath?: string
  readonly now?: () => number
  readonly maxEvents?: number
}

const defaultStatePath = (): string => {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'runtime', 'dshfiles', 'activity-timeline', 'state.json')
}

const initialState = (now: number): ActivityState => ({ schemaVersion: 1, events: [], ingestCount: 0, duplicateCount: 0, startedAt: now })

/** The identity a snapshot is validated against: file metadata plus this process's own write counter. */
const revisionOf = (info: Stats, writeRevision: number): string =>
  `${String(info.dev)}:${String(info.ino)}:${String(info.size)}:${String(info.mtimeMs)}:${String(writeRevision)}`

interface QueuedIngest {
  readonly event: ActivityEvent
  readonly settle: (result: { readonly event: ActivityEvent; readonly duplicate: boolean }) => void
  readonly reject: (error: unknown) => void
}

const cursorOf = (event: ActivityEvent): string => `${String(event.at)}:${event.id}`

const parseCursor = (cursor: string): { readonly at: number; readonly id: string } => {
  const separator = cursor.indexOf(':')
  const at = Number(cursor.slice(0, separator))
  const id = cursor.slice(separator + 1)
  if (separator <= 0 || !Number.isSafeInteger(at) || at < 0 || id.length === 0) throw new ActivityError('invalid-cursor', 'Activity cursor is invalid.')
  return { at, id }
}

const normalize = (input: ActivityIngest): ActivityEvent => {
  const parsed = activityIngestSchema.parse(input)
  return {
    id: parsed.id,
    at: parsed.at,
    source: parsed.source,
    type: parsed.type,
    level: parsed.level ?? 'routine',
    sessionId: parsed.sessionId ?? null,
    workspaceId: parsed.workspaceId ?? null,
    taskId: parsed.taskId ?? null,
    correlationId: parsed.correlationId ?? null,
    causationId: parsed.causationId ?? null,
    summary: parsed.summary,
    detail: parsed.detail ?? null,
    metadata: parsed.metadata ?? {},
    references: parsed.references ?? [],
    provenance: parsed.provenance ?? 'reported',
  }
}

export class ActivityTimelineService {
  readonly #statePath: string
  readonly #now: () => number
  readonly #maxEvents: number
  readonly #listeners = new Set<(event: ActivityEvent) => void>()
  #writes: Promise<void> = Promise.resolve()
  /** Last parsed state, reused while the file's revision and the freshness window agree. */
  #cached: { readonly revision: string; readonly at: number; readonly state: ActivityState } | undefined
  /** Bumped by every own write, so a cached snapshot can never mask one. */
  #writeRevision = 0
  readonly #queued: QueuedIngest[] = []
  #queueTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: ActivityTimelineServiceOptions = {}) {
    this.#statePath = options.statePath ?? defaultStatePath()
    this.#now = options.now ?? Date.now
    this.#maxEvents = Math.max(100, Math.min(MAX_EVENTS, options.maxEvents ?? MAX_EVENTS))
  }

  subscribe(listener: (event: ActivityEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async ingest(input: ActivityIngest): Promise<{ readonly event: ActivityEvent; readonly duplicate: boolean }> {
    const event = normalize(input)
    const [result] = await this.#ingestEvents([event])
    return result ?? { event, duplicate: false }
  }

  /**
   * Buffer one event into the next batch. The promise settles when that batch is durably written, so callers keep
   * acknowledgement semantics while a burst of events costs one read/write cycle instead of one each.
   * @param input - the event to ingest.
   * @returns its stored event and whether it was a duplicate.
   */
  enqueue(input: ActivityIngest): Promise<{ readonly event: ActivityEvent; readonly duplicate: boolean }> {
    const event = normalize(input)
    return new Promise((resolve, reject) => {
      this.#queued.push({ event, settle: resolve, reject })
      if (this.#queued.length >= INGEST_BATCH_LIMIT) {
        void this.#flushQueue().catch(() => undefined)
        return
      }
      if (this.#queueTimer === undefined) {
        this.#queueTimer = setTimeout(() => {
          this.#queueTimer = undefined
          void this.#flushQueue().catch(() => undefined)
        }, INGEST_BATCH_DELAY_MS)
      }
    })
  }

  /** Flush buffered events and wait for the writes already running, so a shutdown stores what it accepted. */
  async drain(): Promise<void> {
    await this.#flushQueue().catch(() => undefined)
    await this.#writes
  }

  async ingestMany(inputs: readonly ActivityIngest[]): Promise<{ readonly ingested: number; readonly duplicates: number }> {
    if (inputs.length === 0) return { ingested: 0, duplicates: 0 }
    const results = await this.#ingestEvents(inputs.map(normalize))
    return {
      ingested: results.filter(result => !result.duplicate).length,
      duplicates: results.filter(result => result.duplicate).length,
    }
  }

  async #flushQueue(): Promise<void> {
    if (this.#queueTimer !== undefined) {
      clearTimeout(this.#queueTimer)
      this.#queueTimer = undefined
    }
    const batch = this.#queued.splice(0)
    if (batch.length === 0) return
    try {
      const results = await this.#ingestEvents(batch.map(item => item.event))
      batch.forEach((item, index) => item.settle(results[index] ?? { event: item.event, duplicate: false }))
    } catch (error) {
      for (const item of batch) item.reject(error)
      throw error
    }
  }

  /** One serialized batch: duplicate detection, ordering, retention and a single durable write. */
  async #ingestEvents(events: readonly ActivityEvent[]): Promise<readonly { readonly event: ActivityEvent; readonly duplicate: boolean }[]> {
    const outcome = await this.#serialize(async () => {
      const state = await this.#readState()
      const byId = new Map(state.events.map(event => [event.id, event]))
      const results: { readonly event: ActivityEvent; readonly duplicate: boolean }[] = []
      const fresh: ActivityEvent[] = []
      let duplicates = 0
      for (const event of events) {
        const existing = byId.get(event.id)
        if (existing !== undefined) {
          duplicates += 1
          results.push({ event: existing, duplicate: true })
          continue
        }
        byId.set(event.id, event)
        fresh.push(event)
        results.push({ event, duplicate: false })
      }
      if (fresh.length === 0) {
        if (duplicates > 0) await this.#writeState({ ...state, duplicateCount: state.duplicateCount + duplicates })
        return { results, fresh }
      }
      const merged = [...state.events, ...fresh].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)).slice(-this.#maxEvents)
      await this.#writeState({
        ...state,
        events: merged,
        ingestCount: state.ingestCount + fresh.length,
        duplicateCount: state.duplicateCount + duplicates,
      })
      return { results, fresh }
    })
    for (const event of outcome.fresh) for (const listener of this.#listeners) listener(event)
    return outcome.results
  }

  async page(filter: ActivityFilter = {}): Promise<ActivityPage> {
    const state = await this.#readState()
    const limit = Math.max(1, Math.min(200, filter.limit ?? DEFAULT_PAGE))
    const cursor = filter.cursor === undefined ? undefined : parseCursor(filter.cursor)
    const search = filter.search?.toLocaleLowerCase()
    const sources = filter.sources === undefined ? undefined : new Set(filter.sources)
    const levels = filter.levels === undefined ? undefined : new Set(filter.levels)
    const matching = state.events.filter(event => {
      if (cursor !== undefined && (event.at > cursor.at || (event.at === cursor.at && event.id >= cursor.id))) return false
      if (filter.before !== undefined && event.at >= filter.before) return false
      if (sources !== undefined && !sources.has(event.source)) return false
      if (levels !== undefined && !levels.has(event.level)) return false
      if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false
      if (filter.correlationId !== undefined && event.correlationId !== filter.correlationId) return false
      if (search !== undefined && !`${event.type} ${event.summary} ${event.detail ?? ''}`.toLocaleLowerCase().includes(search)) return false
      return true
    })
    const slice = matching.slice(-limit)
    const items = ActivityTimelineCondensation.condenseEvents(slice, { detailed: filter.detailed === true })
    const oldest = slice[0]
    return {
      items,
      nextCursor: matching.length > slice.length && oldest !== undefined ? cursorOf(oldest) : null,
      hasMore: matching.length > slice.length,
      newestAt: state.events.length === 0 ? null : (state.events[state.events.length - 1]?.at ?? null),
      attentionCount: state.events.filter(event => event.level === 'attention').length,
      totalRetained: state.events.length,
    }
  }

  async attention(limit = 20): Promise<readonly ActivityEvent[]> {
    const state = await this.#readState()
    return state.events
      .filter(event => event.level === 'attention')
      .slice(-Math.max(1, Math.min(100, limit)))
      .reverse()
  }

  async event(id: string): Promise<ActivityEvent> {
    const state = await this.#readState()
    const event = state.events.find(candidate => candidate.id === id)
    if (event === undefined) throw new ActivityError('event-not-found', 'Activity event is no longer retained.')
    return event
  }

  async related(id: string, limit = 50): Promise<readonly ActivityEvent[]> {
    const state = await this.#readState()
    const event = state.events.find(candidate => candidate.id === id)
    if (event === undefined) throw new ActivityError('event-not-found', 'Activity event is no longer retained.')
    if (event.correlationId === null) return [event]
    return state.events.filter(candidate => candidate.correlationId === event.correlationId).slice(-Math.max(1, Math.min(100, limit)))
  }

  async stats(): Promise<{
    readonly retained: number
    readonly ingested: number
    readonly duplicates: number
    readonly attention: number
    readonly sources: Readonly<Record<string, number>>
  }> {
    const state = await this.#readState()
    const sources: Record<string, number> = {}
    for (const event of state.events) sources[event.source] = (sources[event.source] ?? 0) + 1
    return {
      retained: state.events.length,
      ingested: state.ingestCount,
      duplicates: state.duplicateCount,
      attention: state.events.filter(event => event.level === 'attention').length,
      sources,
    }
  }

  async #readState(): Promise<ActivityState> {
    const info = await stat(this.#statePath).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw new ActivityError('state-unreadable', 'Activity state is unreadable.')
    })
    if (info === undefined) {
      this.#cached = undefined
      return initialState(this.#now())
    }
    const revision = revisionOf(info, this.#writeRevision)
    const cached = this.#cached
    if (cached !== undefined && cached.revision === revision && this.#now() - cached.at < STATE_FRESHNESS_MS) return cached.state
    let text: string
    try {
      text = await readFile(this.#statePath, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return initialState(this.#now())
      throw new ActivityError('state-unreadable', 'Activity state is unreadable.')
    }
    let state: ActivityState
    try {
      state = activityStateSchema.parse(JSON.parse(text))
    } catch {
      throw new ActivityError('state-invalid', 'Activity state is invalid; it was left untouched.')
    }
    this.#cached = { revision, at: this.#now(), state }
    return state
  }

  async #writeState(state: ActivityState): Promise<void> {
    const parsed = activityStateSchema.parse(state)
    const directory = dirname(this.#statePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.#statePath}.tmp-${randomUUID()}`
    await writeFile(temporaryPath, `${JSON.stringify(parsed)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.#statePath)
    // Publish the write into the snapshot, so the read that follows a write costs one stat instead of a full parse.
    this.#writeRevision += 1
    const info = await stat(this.#statePath).catch(() => undefined)
    this.#cached = info === undefined ? undefined : { revision: revisionOf(info, this.#writeRevision), at: this.#now(), state: parsed }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writes.then(operation)
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export const createActivityTimelineService = (options: ActivityTimelineServiceOptions = {}): ActivityTimelineService => new ActivityTimelineService(options)
