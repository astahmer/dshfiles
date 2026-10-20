import type { Context } from '@deepseek-ai/cordis'
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionCheckpoint, ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { readFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import { z } from 'zod'

const ZSTD_MAGIC = 0xfd2fb528

const jsonlLogSchema = z.object({ resolveCurrentLog: z.function() })
const cacheTableSchema = z.object({ requireTable: z.function() })
const cacheRecordSchema = z.object({ rows: z.record(z.string(), z.unknown()) })
const logPathSchema = z.string().endsWith('.zstd')
const rowSchema = z.record(z.string(), z.unknown())
const eventRowSchema = z.looseObject({
  seq: z.number().int().nonnegative(),
  type: z.string(),
  time: z.number(),
  sourceEventSeqs: z.array(z.union([z.number().int().nonnegative(), z.tuple([z.number().int(), z.number().int()])])).optional(),
})

/** The JSONL backend's log lookup, public on its class but absent from the persistence contract. */
interface JsonlLogLookup {
  resolveCurrentLog(id: SessionId, signal?: AbortSignal): Promise<string | undefined>
}

/** The projection cache's in-memory record table, private to its class. */
interface ProjectionCacheTable {
  requireTable(): { get(id: SessionId): z.input<typeof cacheRecordSchema> | undefined }
}

interface FrameRange {
  readonly start: number
  readonly end: number
}

/**
 * The end of one cold Session log, decoded without reading the rest. The JSONL backend writes a header frame and then
 * one independently decodable Zstandard frame per durable append, so the frames nearest the end hold the newest
 * events. `before()` decodes further back on demand; `restore` folds the projection checkpoint over the decoded tail.
 */
export class TailLog {
  private readonly texts = new Map<number, string>()
  private firstFrame: number
  private decoded: readonly SessionEvent[] = []

  private constructor(
    readonly header: SessionHeader,
    private readonly bytes: Buffer,
    private readonly frames: readonly FrameRange[],
  ) {
    this.firstFrame = frames.length
  }

  /**
   * Open the tail of a cold, unforked, current-format zstd log, or `undefined` when only the full read can serve it:
   * another backend or encoding, a forked or subagent Session, a torn last frame.
   */
  static async open(input: { readonly ctx: Context; readonly sessionId: SessionId; readonly signal: AbortSignal }): Promise<TailLog | undefined> {
    const persistence = input.ctx.get('sessionPersistence')
    if (persistence === undefined || !jsonlLogSchema.safeParse(persistence).success) return undefined
    const stat = await persistence.stat(input.sessionId, { signal: input.signal })
    if (stat === undefined || stat.formatStatus !== 'current') return undefined
    const header = stat.header
    if (header.cwd === undefined || header.isSeeded || header.origin === 'subagent') return undefined
    // SAFETY: the schema above proved the JSONL backend's public resolveCurrentLog method is present.
    const lookup = persistence as unknown as JsonlLogLookup
    const path = logPathSchema.safeParse(await lookup.resolveCurrentLog(input.sessionId, input.signal))
    if (!path.success) return undefined
    const bytes = await readFile(path.data, { signal: input.signal })
    const frames = TailLog.scan(bytes)
    if (frames === undefined || frames.length < 2) return undefined
    const tail = new TailLog(header, bytes, frames)
    if (!tail.textOf(frames.length - 1).endsWith('\n')) return undefined
    return tail
  }

  /** Complete frame ranges, or `undefined` when the file ends inside a frame (a torn append the full read repairs). */
  static scan(buffer: Buffer): readonly FrameRange[] | undefined {
    const frames: FrameRange[] = []
    let offset = 0
    while (offset < buffer.length) {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- The frame start stays fixed while `offset` walks the frame.
      const start = offset
      if (buffer.length - offset < 5 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return undefined
      offset += 4
      const descriptor = buffer.readUInt8(offset)
      offset += 1
      if ((descriptor & 24) !== 0) return undefined
      const contentSizeFlag = descriptor >>> 6
      const singleSegment = (descriptor & 32) !== 0
      const dictionaryFlag = descriptor & 3
      offset += (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag)
      for (;;) {
        if (buffer.length - offset < 3) return undefined
        const blockHeader = buffer.readUIntLE(offset, 3)
        offset += 3
        const blockType = (blockHeader >>> 1) & 3
        if (blockType === 3) return undefined
        offset += blockType === 1 ? 1 : blockHeader >>> 3
        if (offset > buffer.length) return undefined
        if ((blockHeader & 1) !== 0) break
      }
      if ((descriptor & 4) !== 0) offset += 4
      if (offset > buffer.length) return undefined
      frames.push({ start, end: offset })
    }
    return frames
  }

  /** Whether the decoded events already start at the first event of the log. */
  get complete(): boolean {
    return this.firstFrame <= 1
  }

  /** Seq of the first decoded event. */
  get base(): number {
    return this.decoded[0]?.seq ?? 0
  }

  /** The decoded newest events, contiguous through the end of the log. */
  get events(): readonly SessionEvent[] {
    return this.decoded
  }

  /**
   * Decode at least `frames` more frames, extended back to a line boundary (the writer may split one record across
   * appends), and return every decoded event.
   */
  before(frames: number): readonly SessionEvent[] {
    let first = Math.max(1, this.firstFrame - frames)
    while (first > 1 && !this.textOf(first - 1).endsWith('\n')) first -= 1
    if (first === this.firstFrame) return this.decoded
    const text = Array.from({ length: this.frames.length - first }, (_, index) => this.textOf(first + index)).join('')
    const events = text
      .split('\n')
      .filter(line => line !== '')
      .map(line => TailLog.eventOf(line))
    for (let index = 1; index < events.length; index += 1) {
      if (events[index]?.seq !== (events[index - 1]?.seq ?? -2) + 1) throw new Error(`session "${this.header.id}" log tail has a seq gap`)
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
    const cache = ctx.get('sessionProjectionCache')
    const registry = ctx.get('sessionProjections')
    if (cache === undefined || registry === undefined) return undefined
    // The public listing read proves this lifecycle owns the stored record before its rows seed a fold.
    if (cache.cachedSnapshot(this.header) === undefined || !cacheTableSchema.safeParse(cache).success) return undefined
    // SAFETY: the schema above proved the cache keeps its rows behind requireTable(); its record is validated below.
    const table = (cache as unknown as ProjectionCacheTable).requireTable()
    const record = cacheRecordSchema.safeParse(table.get(this.header.id))
    if (!record.success) return undefined
    // SAFETY: rows came from the cache's own checkpoint table; restore validates each row's version and watermark.
    const checkpoint = record.data.rows as ProjectionCheckpoint
    const floor = registry.restoreFloor(checkpoint)
    if (floor === undefined || floor < this.base) return undefined
    const suffix = this.decoded.slice(floor - this.base)
    try {
      return registry.restore(checkpoint, suffix, SessionLogOffset(floor), this.header, SessionLogOffset(0)).snapshot
    } catch {
      return undefined
    }
  }

  private textOf(frame: number): string {
    const cached = this.texts.get(frame)
    if (cached !== undefined) return cached
    const range = this.frames[frame]
    if (range === undefined) throw new Error(`session "${this.header.id}" log has no frame ${String(frame)}`)
    const text = zstdDecompressSync(this.bytes.subarray(range.start, range.end)).toString('utf8')
    this.texts.set(frame, text)
    return text
  }

  /** A stored row is its event, except `sourceEventSeqs`, which the writer compresses into `[start, end]` ranges. */
  private static eventOf(line: string): SessionEvent {
    // The row itself is returned, not the schema's output, which would move the declared keys first: the browser copy
    // must match the full read byte for byte.
    const record = rowSchema.parse(JSON.parse(line))
    const sources = eventRowSchema
      .parse(record)
      .sourceEventSeqs?.flatMap(entry =>
        typeof entry === 'number' ? [entry] : Array.from({ length: entry[1] - entry[0] + 1 }, (_, index) => entry[0] + index),
      )
    // SAFETY: the JSONL backend wrote this row from a validated SessionEvent; only the seq ranges differ on disk.
    return (sources === undefined ? record : { ...record, sourceEventSeqs: sources }) as unknown as SessionEvent
  }
}
