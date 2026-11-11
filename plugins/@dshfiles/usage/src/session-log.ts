import { zstdDecompressSync } from 'node:zlib'
import { Effect, FileSystem, Option, Schema } from 'effect'
import { completeZstdFrameEnds } from './zstd-frames.js'

/**
 * Reads DSH session logs (`session.v<N>.jsonl.zstd`) from a byte offset. The
 * JSONL persistence backend appends one independent, checksummed Zstandard
 * frame per durable batch, so a reader can resume at the end of the last
 * complete frame it decoded and never decompress the earlier ones again. A
 * frame the writer has not finished yet stays unread until the next pass.
 */

export interface LogRecord {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: unknown
  readonly [key: string]: unknown
}

export interface LogChunk {
  readonly records: readonly LogRecord[]
  /** Byte offset just past the last complete frame read. */
  readonly endOffset: number
}

export class SessionLogReadFailed extends Schema.TaggedError<SessionLogReadFailed>()('SessionLogReadFailed', {
  path: Schema.String,
  fromOffset: Schema.Number,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not read the session log ${this.path} from byte ${String(this.fromOffset)}.`
  }
}

const parseLines = (text: string, into: LogRecord[]): void => {
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    const value: unknown = JSON.parse(line)
    // SAFETY: only `type` is checked here; every consumer decodes `data` with its own schema.
    if (typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string') into.push(value as LogRecord)
  }
}

const decodeChunk = (input: { readonly path: string; readonly fromOffset: number; readonly bytes: Buffer }): LogChunk => {
  const records: LogRecord[] = []
  if (!input.path.endsWith('.zstd')) {
    const lastNewline = input.bytes.lastIndexOf(0x0a)
    if (lastNewline < 0) return { records, endOffset: input.fromOffset }
    parseLines(input.bytes.subarray(0, lastNewline).toString('utf8'), records)
    return { records, endOffset: input.fromOffset + lastNewline + 1 }
  }
  let start = 0
  for (const end of completeZstdFrameEnds(input.bytes)) {
    parseLines(zstdDecompressSync(input.bytes.subarray(start, end)).toString('utf8'), records)
    start = end
  }
  return { records, endOffset: input.fromOffset + start }
}

/**
 * Read every complete record between `fromOffset` and `size`; plain `.jsonl` logs resume at the last newline.
 * Untraced: one index pass reads thousands of files and owns the span.
 */
export const readLogFrom = Effect.fnUntraced(function* (input: { readonly path: string; readonly fromOffset: number; readonly size: number }) {
  if (input.size <= input.fromOffset) return { records: [], endOffset: input.fromOffset } satisfies LogChunk
  const fileSystem = yield* FileSystem.FileSystem
  const failed = (cause: unknown) => new SessionLogReadFailed({ path: input.path, fromOffset: input.fromOffset, cause })
  const read = yield* fileSystem.open(input.path, { flag: 'r' }).pipe(
    Effect.flatMap(file => file.readAlloc(input.size - input.fromOffset, { position: BigInt(input.fromOffset) })),
    Effect.scoped,
    Effect.mapError(failed),
  )
  const bytes = Option.match(read, { onNone: () => Buffer.alloc(0), onSome: buffer => Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength) })
  return yield* Effect.try({ try: () => decodeChunk({ path: input.path, fromOffset: input.fromOffset, bytes }), catch: failed })
})
