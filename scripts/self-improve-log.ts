import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { z } from 'zod'
import { decodeJson } from './json.ts'

/**
 * Discovers and streams DSH Session logs (`session.v<N>.jsonl.zstd`).
 *
 * The frame walk mirrors `plugins/@dshfiles/usage/src/session-log.ts`: the JSONL
 * backend appends one independent, checksummed Zstandard frame per durable
 * batch, so a reader resumes at the end of the last complete frame and never
 * decompresses earlier frames again. Slicing keeps a multi-hundred-megabyte
 * Session from being held in memory at once.
 */

const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/
const ZSTD_MAGIC = 0xfd2fb528
const SLICE_BYTES = 4 * 1024 * 1024

const logRecordSchema = z.object({ type: z.string(), seq: z.number().optional(), time: z.number().optional(), data: z.unknown().optional() }).passthrough()

export type LogRecord = z.infer<typeof logRecordSchema>

export interface SessionLogRef {
  readonly sessionId: string
  readonly project: string
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
}

/** End offsets of the complete frames in `buffer`; a torn final frame is left out. */
const completeFrameEnds = (buffer: Buffer): number[] => {
  const ends: number[] = []
  let offset = 0
  while (offset + 5 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`not a Zstandard frame at byte ${String(offset)}`)
    let cursor = offset + 4
    const descriptor = buffer.readUInt8(cursor)
    cursor += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    cursor += (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag)
    let complete = false
    while (cursor + 3 <= buffer.length) {
      const header = buffer.readUIntLE(cursor, 3)
      cursor += 3
      cursor += ((header >>> 1) & 3) === 1 ? 1 : header >>> 3
      if ((header & 1) === 1) {
        complete = true
        break
      }
    }
    if (checksum) cursor += 4
    if (!complete || cursor > buffer.length) break
    ends.push(cursor)
    offset = cursor
  }
  return ends
}

const parseLines = (text: string, into: LogRecord[]): void => {
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    const parsed = SessionLogs.decodeJsonSafe(logRecordSchema, line)
    if (parsed !== undefined) into.push(parsed)
  }
}

const readLogSlice = async (input: {
  readonly path: string
  readonly fromOffset: number
  readonly size: number
}): Promise<{ readonly records: LogRecord[]; readonly endOffset: number }> => {
  if (input.size <= input.fromOffset) return { records: [], endOffset: input.fromOffset }
  const handle = await open(input.path, 'r')
  try {
    const buffer = Buffer.alloc(input.size - input.fromOffset)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, input.fromOffset)
    const bytes = buffer.subarray(0, bytesRead)
    const records: LogRecord[] = []
    if (!input.path.endsWith('.zstd')) {
      const lastNewline = bytes.lastIndexOf(0x0a)
      if (lastNewline < 0) return { records, endOffset: input.fromOffset }
      parseLines(bytes.subarray(0, lastNewline).toString('utf8'), records)
      return { records, endOffset: input.fromOffset + lastNewline + 1 }
    }
    let start = 0
    for (const end of completeFrameEnds(bytes)) {
      parseLines(zstdDecompressSync(bytes.subarray(start, end)).toString('utf8'), records)
      start = end
    }
    return { records, endOffset: input.fromOffset + start }
  } finally {
    await handle.close()
  }
}

/** The newest log generation in one Session directory, or `undefined` when the Session wrote none. */
const newestLog = async (sessionDirectory: string): Promise<string | undefined> => {
  let best: { readonly name: string; readonly version: number } | undefined
  for (const name of await readdir(sessionDirectory).catch(() => [])) {
    const match = LOG_NAME.exec(name)
    if (match === null) continue
    const version = Number(match[1] ?? 0)
    if (best === undefined || version > best.version) best = { name, version }
  }
  return best === undefined ? undefined : join(sessionDirectory, best.name)
}

const streamSessionRecords = async function* (path: string): AsyncGenerator<LogRecord> {
  const info = await stat(path)
  let offset = 0
  while (offset < info.size) {
    const window = Math.min(info.size, offset + SLICE_BYTES)
    let chunk = await readLogSlice({ path, fromOffset: offset, size: window })
    if (chunk.endOffset === offset && window < info.size) chunk = await readLogSlice({ path, fromOffset: offset, size: info.size })
    if (chunk.endOffset === offset) return
    for (const record of chunk.records) yield record
    offset = chunk.endOffset
  }
}

const discoverSessionLogs = async (root: string): Promise<SessionLogRef[]> => {
  const refs: SessionLogRef[] = []
  for (const projectEntry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!projectEntry.isDirectory()) continue
    const projectDirectory = join(root, projectEntry.name)
    for (const sessionEntry of await readdir(projectDirectory, { withFileTypes: true }).catch(() => [])) {
      if (!sessionEntry.isDirectory()) continue
      const sessionDirectory = join(projectDirectory, sessionEntry.name)
      const path = await newestLog(sessionDirectory)
      if (path === undefined) continue
      const info = await stat(path).catch(() => undefined)
      if (info === undefined || info.size === 0) continue
      refs.push({ sessionId: sessionEntry.name, project: projectEntry.name, path, size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  return refs
}

/** `2026-10-19` → a Unix-ms instant, `7d` → a duration in ms, `all` → `undefined`. */
const parseSince = (input: string, now: number): number | undefined => {
  if (input === 'all' || input.length === 0) return undefined
  const duration = /^(\d+)(m|h|d|w)$/.exec(input)
  if (duration !== null) {
    const amount = Number(duration[1])
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[duration[2] ?? 'd'] ?? 86_400_000
    return now - amount * unitMs
  }
  const date = Date.parse(input)
  if (Number.isNaN(date)) throw new Error(`unrecognized --since value: ${input}`)
  return date
}

/**
 * Reading Session logs, plus the one place the tool decodes JSON text: every
 * parse in this toolkit goes through `decodeJson`, so untrusted log lines,
 * reports and flags are always schema-validated before use.
 */
export class SessionLogs {
  static readonly decodeJson = <Schema extends z.ZodType>(schema: Schema, text: string): z.output<Schema> => decodeJson(schema, text)

  static readonly decodeJsonSafe = <Output>(schema: z.ZodType<Output>, text: string): Output | undefined => {
    try {
      return SessionLogs.decodeJson(schema, text)
    } catch {
      return undefined
    }
  }

  static readonly discover = discoverSessionLogs
  static readonly stream = streamSessionRecords
  static readonly parseSince = parseSince
}
