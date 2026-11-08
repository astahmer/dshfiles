import type { Context } from '@deepseek-ai/cordis'
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionCheckpoint, ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { zstdDecompressSync } from 'node:zlib'
import { Schema } from 'effect'
import { fileIdentityOf, fileSizeOf, readFileHead, readFileWindow, scanFramesPrefix, scanWindowFrames, type FrameRange } from './frames.ts'

/** Below this a log decodes whole about as fast as its tail (median 155 ms vs 170 ms measured), so it keeps the full read. */
export const MIN_TAIL_BYTES = 1_000_000
/**
 * Bytes read from the end of a log first. The newest frames hold the newest events, so an 86 MB log costs 4 MB here:
 * 2 ms instead of 153 ms plus 86 MB of buffer per concurrent cold open.
 */
export const TAIL_WINDOW_BYTES = 4_000_000
/**
 * Bytes read from the start of a log for a reader that needs one early event (a title provenance row): the first
 * durable appends hold it and cost 0.25 MB instead of the log's whole 86 MB.
 */
export const HEAD_WINDOW_BYTES = 256_000
/**
 * How many times the window doubles when it holds fewer than two complete frames (a log of huge appends). Six growths
 * meant a 256 MB window per tail, so three kept tails could hold 768 MB of the Host for logs nobody was reading; two
 * growths cap one at 16 MB, and a log whose appends still do not fit falls back to the full read.
 */
const TAIL_WINDOW_GROWTHS = 2
/** Opened tails kept for the opening's next pages; each holds its log's bytes. */
const KEPT_TAILS = 2
const KEPT_TAIL_MS = 120_000
/**
 * Decoded events one tail keeps. `before()` used to prepend every page a reader asked for, so paging back through a
 * large log grew this array to the whole log (a 24.9 MB log decodes to ~96 MB of events). Past this many events the
 * oldest are dropped and the tail stops claiming to restore a checkpoint, which sends that read to the full path.
 */
const MAX_DECODED_EVENTS = 4_096

const cacheRecordSchema = Schema.Struct({ rows: Schema.Record(Schema.String, Schema.Unknown) })
const logPathSchema = Schema.String.check(Schema.isEndingWith('.zstd'))
const rowSchema = Schema.Record(Schema.String, Schema.Unknown)
const nonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const eventRowSchema = Schema.Struct({
  seq: nonNegativeInt,
  type: Schema.String,
  time: Schema.Number,
  sourceEventSeqs: Schema.optional(
    Schema.Array(Schema.Union([nonNegativeInt, Schema.Tuple([Schema.Number.check(Schema.isInt()), Schema.Number.check(Schema.isInt())])])),
  ),
})

/**
 * Phases one open measured, in milliseconds, plus how it was served. A caller owns the span; this bag is its attributes.
 */
export type LogWindowMetrics = {
  cache_hit?: boolean
  fallback_reason?: string
  [phase: string]: number | boolean | string | undefined
}

/** The JSONL backend's log lookup, public on its class but absent from the persistence contract. */
interface JsonlLogLookup {
  resolveCurrentLog(id: SessionId, signal?: AbortSignal): Promise<string | undefined>
}

/** The projection cache's in-memory record table, private to its class. */
interface ProjectionCacheTable {
  requireTable(): { get(id: SessionId): object | undefined }
}

const isJsonlLogLookup = (value: unknown): value is JsonlLogLookup =>
  typeof value === 'object' && value !== null && 'resolveCurrentLog' in value && typeof value.resolveCurrentLog === 'function'

const isProjectionCacheTable = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'requireTable' in value && typeof value.requireTable === 'function'

const measure = async <Value>(metrics: LogWindowMetrics, phase: string, work: () => Value | Promise<Value>): Promise<Value> => {
  const startedAt = performance.now()
  try {
    return await work()
  } finally {
    metrics[phase] = Math.round(performance.now() - startedAt)
  }
}

/** Where one eligible log lives, as the tail, head and recent-event reads all need it. */
interface ResolvedLog {
  readonly header: SessionHeader
  readonly path: string
  /** The file's size right now, which is what a window read must be clamped to. */
  readonly sizeBytes: number
  /** The size the persistence backend reported, which decides whether a log is worth a window at all. */
  readonly statSizeBytes: number | undefined
}

/** What every bounded read needs, with an optional metrics bag the caller owns. */
export interface LogWindowInput {
  readonly ctx: Context
  readonly sessionId: SessionId
  readonly signal: AbortSignal
  readonly metrics?: LogWindowMetrics
}

interface OpenInput extends LogWindowInput {
  readonly metrics: LogWindowMetrics
}

/** Fold a public input into the internal one; a caller with no span still gets its measurements recorded. */
const withMetrics = (input: LogWindowInput): OpenInput => ({ ...input, metrics: input.metrics ?? {} })

/**
 * Resolve the current stored log of one Session to its path and size, or `undefined` when only the full read can serve
 * it: no persistence, another backend, a migration-required format, or a log path that is not the JSONL zstd artifact.
 */
const resolveLog = async (input: OpenInput): Promise<ResolvedLog | undefined> => {
  const persistence = input.ctx.get('sessionPersistence')
  if (persistence === undefined || !isJsonlLogLookup(persistence)) {
    input.metrics.fallback_reason = 'persistence-unavailable'
    return undefined
  }
  const snapshot = await measure(input.metrics, 'stat_ms', () => persistence.stat(input.sessionId, { signal: input.signal }))
  if (snapshot === undefined) {
    input.metrics.fallback_reason = 'stat-missing'
    return undefined
  }
  if (snapshot.formatStatus !== 'current') {
    input.metrics.fallback_reason = 'unsupported-format'
    return undefined
  }
  const currentPath = await measure(input.metrics, 'lookup_ms', () => persistence.resolveCurrentLog(input.sessionId, input.signal))
  const path = Schema.decodeUnknownResult(logPathSchema)(currentPath)
  if (path._tag === 'Failure') {
    input.metrics.fallback_reason = 'log-path-unavailable'
    return undefined
  }
  const sizeBytes = await measure(input.metrics, 'size_ms', () => fileSizeOf(path.success))
  if (sizeBytes === undefined) {
    input.metrics.fallback_reason = 'log-size-unavailable'
    return undefined
  }
  return { header: snapshot.header, path: path.success, sizeBytes, statSizeBytes: snapshot.sizeBytes }
}

/**
 * The end of one cold Session log, decoded without reading the rest. The JSONL backend writes a header frame and then
 * one independently decodable Zstandard frame per durable append, so the frames nearest the end hold the newest
 * events. `before()` decodes further back on demand; `restore` folds the projection checkpoint over the decoded tail.
 */
export class TailLog {
  private static readonly kept = new Map<SessionId, { readonly path: string; readonly identity: string; readonly tail: TailLog; timer: NodeJS.Timeout }>()
  private readonly texts = new Map<number, string>()
  /** The stored header of the Session this window belongs to. */
  readonly header: SessionHeader
  private readonly bytes: Buffer
  private readonly frames: readonly FrameRange[]
  /** Whether `bytes` starts at the beginning of the log; a window starts at its newest frames instead. */
  private readonly holdsFromLogStart: boolean
  private readonly path: string
  private firstFrame: number
  private decoded: readonly SessionEvent[] = []
  private truncated = false

  private constructor(header: SessionHeader, bytes: Buffer, frames: readonly FrameRange[], holdsFromLogStart: boolean, path: string) {
    this.header = header
    this.bytes = bytes
    this.frames = frames
    this.holdsFromLogStart = holdsFromLogStart
    this.path = path
    this.firstFrame = frames.length
  }

  /**
   * Open the tail of a cold, unforked, current-format zstd log, or `undefined` when only the full read can serve it:
   * another backend or encoding, a forked or subagent Session, a torn last frame.
   * @param input - the Host context, the stored Session, cancellation, the caller's metrics bag, and whether to keep
   *   the opened tail for that Session's next page. A title read keeps nothing: it reads dozens of Sessions once.
   */
  static async open(
    publicInput: LogWindowInput & { readonly retain?: boolean; readonly windowBytes?: number },
  ): Promise<TailLog | undefined> {
    const input = withMetrics(publicInput)
    const windowBytes = publicInput.windowBytes ?? TAIL_WINDOW_BYTES
    const kept = TailLog.kept.get(input.sessionId)
    if (kept !== undefined) {
      // An unchanged file is the same log, already scanned and partly decoded.
      const identity = await measure(input.metrics, 'identity_ms', () => fileIdentityOf(kept.path))
      if (identity === kept.identity) {
        input.metrics.cache_hit = true
        kept.timer.refresh()
        return kept.tail
      }
      TailLog.forget(input.sessionId)
    }
    const resolved = await resolveLog(input)
    if (resolved === undefined) return undefined
    if ((resolved.statSizeBytes ?? 0) < MIN_TAIL_BYTES) {
      input.metrics.fallback_reason = 'below-tail-size-threshold'
      return undefined
    }
    const header = resolved.header
    if (header.cwd === undefined || header.isSeeded || header.origin === 'subagent') {
      input.metrics.fallback_reason = 'ineligible-session'
      return undefined
    }
    const identity = await measure(input.metrics, 'identity_ms', () => fileIdentityOf(resolved.path))
    if (identity === undefined) {
      input.metrics.fallback_reason = 'log-identity-unavailable'
      return undefined
    }
    const opened = await TailLog.readTail(resolved, windowBytes, input)
    if (opened === undefined) {
      input.metrics.fallback_reason = 'invalid-zstd-frames'
      return undefined
    }
    const tail = new TailLog(header, opened.bytes, opened.frames, opened.holdsFromLogStart, resolved.path)
    const finalLineComplete = await measure(input.metrics, 'decode_ms', () => tail.textOf(opened.frames.length - 1).endsWith('\n'))
    if (!finalLineComplete) {
      input.metrics.fallback_reason = 'incomplete-final-line'
      return undefined
    }
    if (publicInput.retain !== false) TailLog.keep(input.sessionId, { path: resolved.path, identity, tail })
    return tail
  }

  /** The log's newest window with its complete frames: the whole file only when it is small or holds one huge append. */
  private static async readTail(
    resolved: ResolvedLog,
    /** Leading window size; a caller that only needs the newest event asks for far less than the transcript's page. */
    windowBytes: number,
    input: OpenInput,
  ): Promise<{ readonly bytes: Buffer; readonly frames: readonly FrameRange[]; readonly holdsFromLogStart: boolean } | undefined> {
    let nextBytes = Math.min(resolved.sizeBytes, windowBytes)
    for (let attempt = 0; attempt <= TAIL_WINDOW_GROWTHS; attempt += 1) {
      const bytes = await measure(input.metrics, 'read_ms', () =>
        readFileWindow({ path: resolved.path, sizeBytes: resolved.sizeBytes, windowBytes: nextBytes, signal: input.signal }),
      )
      if (bytes === undefined) return undefined
      const frames = await measure(input.metrics, 'scan_ms', () => scanWindowFrames(bytes))
      if (frames !== undefined && frames.length >= 2) {
        return { bytes, frames, holdsFromLogStart: bytes.length === resolved.sizeBytes }
      }
      if (bytes.length === resolved.sizeBytes) return undefined
      nextBytes = Math.min(resolved.sizeBytes, nextBytes * 2)
    }
    return undefined
  }

  private static keep(sessionId: SessionId, entry: { readonly path: string; readonly identity: string; readonly tail: TailLog }): void {
    TailLog.forget(sessionId)
    for (const oldest of TailLog.kept.keys()) {
      if (TailLog.kept.size < KEPT_TAILS) break
      TailLog.forget(oldest)
    }
    const timer = setTimeout(() => {
      TailLog.forget(sessionId)
    }, KEPT_TAIL_MS)
    timer.unref()
    TailLog.kept.set(sessionId, { ...entry, timer })
  }

  private static forget(sessionId: SessionId): void {
    const kept = TailLog.kept.get(sessionId)
    if (kept === undefined) return
    clearTimeout(kept.timer)
    TailLog.kept.delete(sessionId)
  }

  /** Whether the decoded events already start at the first event of the log. */
  get complete(): boolean {
    return this.holdsFromLogStart && this.firstFrame <= 1 && !this.truncated
  }

  /** Frames decoded so far; unchanged means the window holds nothing further back. */
  get decodedFrames(): number {
    return this.firstFrame
  }

  /** Seq of the first decoded event. */
  get base(): number {
    return this.decoded[0]?.seq ?? 0
  }

  /** The decoded newest events, contiguous through the end of the log. */
  get events(): readonly SessionEvent[] {
    return this.decoded
  }

  /** The newest decoded event. */
  get last(): SessionEvent | undefined {
    return this.decoded.at(-1)
  }

  /** The stored log this tail decodes, for a caller that reads the same file again. */
  get logPath(): string {
    return this.path
  }

  /** Bytes this window read from the log: its cost, and the reason a windowed tail is not the whole log. */
  get windowBytes(): number {
    return this.bytes.length
  }

  /** Complete frames this window holds; none once the decoded cap truncated the tail. */
  get frameCount(): number {
    return this.truncated ? 0 : this.frames.length
  }

  /** Whether this window starts after the beginning of the log. */
  get windowed(): boolean {
    return !this.holdsFromLogStart
  }

  /**
   * Decode at least `frames` more frames, extended back to a line boundary (the writer may split one record across
   * appends), and return every decoded event.
   */
  before(frames: number): readonly SessionEvent[] {
    let first = Math.max(1, this.firstFrame - frames)
    while (first > 1 && !this.textOf(first - 1).endsWith('\n')) first -= 1
    if (first === this.firstFrame) return this.decoded
    // Frame `firstFrame - 1` ends a record (checked when `firstFrame` was chosen), so only the new frames are parsed.
    const parts: string[] = []
    for (let frame = first; frame < this.firstFrame; frame += 1) {
      parts.push(this.textOf(frame))
      this.texts.delete(frame)
    }
    const added = parts
      .join('')
      .split('\n')
      .filter(line => line !== '')
      .map(line => eventOf(line))
    const events = [...added, ...this.decoded]
    for (let index = 1; index <= added.length && index < events.length; index += 1) {
      if (events[index]?.seq !== (events[index - 1]?.seq ?? -2) + 1) throw new Error(`session "${this.header.id}" log tail has a seq gap`)
    }
    // Truncation is terminal: once the cap drops the oldest events, the frames no longer line up with what is decoded,
    // so the tail stops claiming to page further back instead of throwing a seq gap on the next page.
    if (events.length > MAX_DECODED_EVENTS) {
      this.truncated = true
      this.decoded = events.slice(events.length - MAX_DECODED_EVENTS)
      return this.decoded
    }
    this.firstFrame = first
    this.decoded = events
    return events
  }

  /**
   * Fold the cached projection checkpoint over the decoded tail through the registry's cold-read path. `undefined`
   * when no checkpoint of this lifecycle exists or the tail does not reach back to its watermark.
   */
  restore(ctx: Context): ProjectionSnapshot | undefined {
    if (this.truncated) return undefined
    const cache = ctx.get('sessionProjectionCache')
    const registry = ctx.get('sessionProjections')
    if (cache === undefined || registry === undefined) return undefined
    // The public listing read proves this lifecycle owns the stored record before its rows seed a fold.
    if (cache.cachedSnapshot(this.header) === undefined || !isProjectionCacheTable(cache)) return undefined
    // SAFETY: the check above proved the cache keeps its rows behind requireTable(); its record is validated below.
    const table = (cache as unknown as ProjectionCacheTable).requireTable()
    const record = Schema.decodeUnknownResult(cacheRecordSchema)(table.get(this.header.id))
    if (record._tag === 'Failure') return undefined
    // SAFETY: rows came from the cache's own checkpoint table; restore validates each row's version and watermark.
    const checkpoint = record.success.rows as ProjectionCheckpoint
    const floor = registry.restoreFloor(checkpoint)
    if (floor === undefined || floor < this.base) return undefined
    const suffix = this.decoded.slice(floor - this.base)
    try {
      return registry.restore(checkpoint, suffix, SessionLogOffset(floor), this.header, SessionLogOffset(0)).snapshot
    } catch {
      return undefined
    }
  }

  /** Plaintext of one frame; kept only until `before()` parses it, so decoded text is never held twice. */
  private textOf(frame: number): string {
    const cached = this.texts.get(frame)
    if (cached !== undefined) return cached
    const range = this.frames[frame]
    if (range === undefined) throw new Error(`session "${this.header.id}" log has no frame ${String(frame)}`)
    const text = zstdDecompressSync(this.bytes.subarray(range.start, range.end)).toString('utf8')
    this.texts.set(frame, text)
    return text
  }

}

/** A stored row is its event, except `sourceEventSeqs`, which the writer compresses into `[start, end]` ranges. */
const eventOf = (line: string): SessionEvent => {
  // The row itself is returned, not the schema's output, which would move the declared keys first: the browser copy
  // must match the full read byte for byte.
  const record = Schema.decodeUnknownSync(Schema.fromJsonString(rowSchema))(line)
  const sources = Schema.decodeUnknownSync(eventRowSchema)(record).sourceEventSeqs?.flatMap(entry =>
    typeof entry === 'number' ? [entry] : Array.from({ length: entry[1] - entry[0] + 1 }, (_, index) => entry[0] + index),
  )
  // SAFETY: the JSONL backend wrote this row from a validated SessionEvent; only the seq ranges differ on disk.
  return (sources === undefined ? record : { ...record, sourceEventSeqs: sources }) as unknown as SessionEvent
}

/** The first events of one stored log, decoded from its first bytes. */
export interface LogHead {
  readonly header: SessionHeader
  /** Every complete event of the window, oldest first. */
  readonly events: readonly SessionEvent[]
  /** Whether the window covered the whole log, so `events` is the complete log. */
  readonly reachesLogEnd: boolean
  /** Physical size of the whole log, so a caller can tell when reading it whole is cheaper than proving a window. */
  readonly sizeBytes: number
}

/**
 * Open the beginning of one stored log: the frames a Session writes when it starts, decoded from `windowBytes`.
 *
 * Unlike the tail, this serves every current-format log, including a forked or subagent Session: it folds no
 * checkpoint, so it needs no lineage proof and no minimum size.
 * @param input - the Host context, the stored Session, cancellation and the caller's metrics bag.
 * @param windowBytes - how many leading bytes to read; defaults to {@link HEAD_WINDOW_BYTES}.
 * @returns the decoded window, or `undefined` when only the full read can serve it.
 */
export const openLogHead = async (
  publicInput: LogWindowInput,
  windowBytes: number = HEAD_WINDOW_BYTES,
): Promise<LogHead | undefined> => {
  const input = withMetrics(publicInput)
  const resolved = await resolveLog(input)
  if (resolved === undefined) return undefined
  const bytes = await measure(input.metrics, 'read_ms', () =>
    readFileHead({ path: resolved.path, sizeBytes: resolved.sizeBytes, windowBytes, signal: input.signal }),
  )
  if (bytes === undefined) {
    input.metrics.fallback_reason = 'log-head-unavailable'
    return undefined
  }
  const frames = await measure(input.metrics, 'scan_ms', () => scanFramesPrefix(bytes))
  if (frames === undefined) {
    input.metrics.fallback_reason = 'invalid-zstd-frames'
    return undefined
  }
  const { events, complete: wholeFramesRead } = await measure(input.metrics, 'decode_ms', () => decodeFrames(bytes, frames))
  const reachesLogEnd = wholeFramesRead && bytes.length === resolved.sizeBytes && events.length > 0
  input.metrics.bytes = bytes.length
  input.metrics.frames = frames.length
  return { header: resolved.header, events, reachesLogEnd, sizeBytes: resolved.sizeBytes }
}

/** Whether one stored row is an event rather than the log's leading header row, which carries no seq. */
const isEventRow = (line: string): boolean => Schema.decodeUnknownResult(Schema.fromJsonString(eventRowSchema))(line)._tag === 'Success'

/** Decode the events of complete frames, oldest first, plus whether every frame yielded its records whole. */
const decodeFrames = (bytes: Buffer, frames: readonly FrameRange[]): { readonly events: readonly SessionEvent[]; readonly complete: boolean } => {
  const events: SessionEvent[] = []
  let previousSeq: number | undefined
  let complete = true
  // The first frame is the stored header, written at creation; every event starts after it.
  let firstRow = true
  for (const frame of frames) {
    const text = zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8')
    // A record the writer split across appends is only complete at the frame that ends with a newline.
    if (!text.endsWith('\n')) {
      complete = false
      continue
    }
    for (const line of text.split('\n')) {
      if (line === '') continue
      if (firstRow) {
        firstRow = false
        if (!isEventRow(line)) continue
      }
      const event = eventOf(line)
      if (events.length > 0 && previousSeq !== undefined && event.seq !== previousSeq + 1) return { events, complete: false }
      previousSeq = event.seq
      events.push(event)
    }
  }
  return { events, complete }
}

/** What a bounded scan of the newest events found, and whether it reached the beginning of the log. */
export interface RecentLogEvents {
  /** The stored header of the Session the window was read from. */
  readonly session: SessionHeader
  /** Matching events in log order, at most the requested count. */
  readonly events: readonly SessionEvent[]
  /** Whether the decoded window covered the whole log, so no earlier match can exist. */
  readonly complete: boolean
}

/**
 * The newest events of one stored log that a predicate selects, decoded from the log's end until `keep` of them are
 * found or the window reaches the log's first event.
 * @param input - the Host context, the stored Session, cancellation, the selector and how many matches are enough.
 * @returns the matching events plus whether the scan saw the whole log, or `undefined` when the tail cannot serve the
 *   read and the caller must fall back to the full one.
 */
export const recentLogEvents = async (
  publicInput: LogWindowInput & { readonly matches: (event: SessionEvent) => boolean; readonly keep: number },
): Promise<RecentLogEvents | undefined> => {
  const input = withMetrics(publicInput)
  const tail = await TailLog.open({ ...input, retain: false })
  if (tail === undefined) return undefined
  for (let frames = 16; ; frames *= 2) {
    input.signal.throwIfAborted()
    const decodedFrames = tail.decodedFrames
    const events = tail.before(frames)
    const matched = events.filter(publicInput.matches)
    if (matched.length >= publicInput.keep) return { session: tail.header, events: matched.slice(-publicInput.keep), complete: tail.complete }
    if (tail.complete) return { session: tail.header, events: matched, complete: true }
    // A window that decoded its first frame holds nothing further back: only the full read can serve the rest.
    if (tail.decodedFrames === decodedFrames) return undefined
  }
}
