/**
 * The session-log container reader. The JSONL persistence backend writes each log as a sequence of concatenated,
 * independently decodable, checksummed Zstandard frames, so a reader can resume at a stored byte offset and decode only
 * what the log gained. That resume property is what makes incremental ingest possible; a one-shot decoder stops at the
 * first frame (measured: 208 bytes for a 26 MB log) and must not be used here.
 */
import { open, readdir, stat } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import { sessionHeaderSchema, type SessionHeaderRow } from './protocol.js'

const ZSTD_MAGIC = 4247762216
const HEADER_BYTES = 64 * 1024
const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/

export interface FrameRange {
  readonly start: number
  readonly end: number
}

export interface DecodedLog {
  /** Decoded plaintext from the resume offset up to the last complete frame. */
  readonly text: string
  /** Frame ranges that produced `text`. */
  readonly frames: readonly FrameRange[]
  /** Byte offset a later pass resumes from; the end of the last complete frame. */
  readonly offset: number
  /** True when the file ends inside a frame or inside a line, so more bytes may still arrive. */
  readonly torn: boolean
}

export interface SessionLogFile {
  readonly sessionId: string
  readonly path: string
  readonly size: number
  readonly dev: string
  readonly ino: string
  readonly mtimeNs: string
  readonly ctimeNs: string
}

export class FrameLog {
  /** Locate complete frames without decompressing their blocks; an incomplete final frame is simply not returned. */
  static scan(buffer: Buffer, from = 0): readonly FrameRange[] {
    const frames: FrameRange[] = []
    let offset = from
    while (offset < buffer.length) {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- The frame start stays fixed while `offset` walks the frame.
      const start = offset
      if (buffer.length - offset < 4) return frames
      if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`corrupt session log: invalid frame magic at byte ${offset}`)
      offset += 4
      if (offset === buffer.length) return frames
      const descriptor = buffer.readUInt8(offset)
      offset += 1
      if ((descriptor & 24) !== 0) throw new Error(`corrupt session log: reserved frame-header bit at byte ${offset - 1}`)
      const contentSizeFlag = descriptor >>> 6
      const singleSegment = (descriptor & 32) !== 0
      const checksum = (descriptor & 4) !== 0
      const dictionaryFlag = descriptor & 3
      const remainingHeaderBytes =
        (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag)
      if (buffer.length - offset < remainingHeaderBytes) return frames
      offset += remainingHeaderBytes
      for (;;) {
        if (buffer.length - offset < 3) return frames
        const blockHeader = buffer.readUIntLE(offset, 3)
        offset += 3
        const lastBlock = (blockHeader & 1) !== 0
        const blockType = (blockHeader >>> 1) & 3
        const blockSize = blockHeader >>> 3
        if (blockType === 3) throw new Error(`corrupt session log: reserved block type at byte ${offset - 3}`)
        const payloadBytes = blockType === 1 ? 1 : blockSize
        if (buffer.length - offset < payloadBytes) return frames
        offset += payloadBytes
        if (lastBlock) break
      }
      if (checksum) {
        if (buffer.length - offset < 4) return frames
        offset += 4
      }
      frames.push({ start, end: offset })
      if (offset === start) throw new Error('corrupt session log: frame scan made no progress')
    }
    return frames
  }

  /**
   * Decode complete frames from `from`. The returned offset stops before any frame whose plaintext ends mid-line, so the
   * next pass re-decodes that frame instead of losing the beginning of an event.
   */
  static decodeFrom(buffer: Buffer, from = 0, limitBytes = Number.POSITIVE_INFINITY): DecodedLog {
    const ranges = FrameLog.scan(buffer, from)
    const parts: string[] = []
    const consumed: FrameRange[] = []
    let decodedBytes = 0
    let holdFrom: number | undefined
    for (const range of ranges) {
      const text = zstdDecompressSync(buffer.subarray(range.start, range.end)).toString('utf8')
      parts.push(text)
      decodedBytes += text.length
      if (text.endsWith('\n')) {
        consumed.push(range)
        if (decodedBytes >= limitBytes) break
        continue
      }
      holdFrom = range.start
      break
    }
    const last = consumed.at(-1)
    return {
      text: holdFrom === undefined ? parts.join('') : parts.slice(0, consumed.length).join(''),
      frames: consumed,
      offset: last === undefined ? from : last.end,
      torn: holdFrom !== undefined || consumed.length < ranges.length,
    }
  }

  /** The header is the first line the writer emits, so it lives inside the log's first frame. */
  static async readHeader(path: string): Promise<SessionHeaderRow> {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(HEADER_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0)
      const view = buffer.subarray(0, bytesRead)
      const first = FrameLog.scan(view)[0]
      if (first === undefined) throw new Error(`no complete Zstandard frame in the first ${String(HEADER_BYTES)} bytes of ${path}`)
      const text = zstdDecompressSync(view.subarray(first.start, first.end)).toString('utf8')
      const newline = text.indexOf('\n')
      return sessionHeaderSchema.parse(JSON.parse(newline < 0 ? text : text.slice(0, newline)))
    } finally {
      await handle.close()
    }
  }

  /** The log generation the persistence backend reads for a session directory: the highest `session[.vN].jsonl[.zstd]`. */
  static async currentLog(sessionDirectory: string): Promise<string | undefined> {
    let best: { readonly path: string; readonly version: number } | undefined
    for (const name of await readdir(sessionDirectory).catch(() => [])) {
      const match = LOG_NAME.exec(name)
      if (match === null) continue
      const version = Number(match[1] ?? 0)
      if (best === undefined || version > best.version) best = { path: `${sessionDirectory}/${name}`, version }
    }
    return best?.path
  }

  /** Walk `root/<project>/<session>/<current log>`; the shape the JSONL persistence store writes. */
  static async list(root: string): Promise<readonly SessionLogFile[]> {
    const logs: SessionLogFile[] = []
    for (const project of await FrameLog.#directories(root)) {
      for (const sessionDirectory of await FrameLog.#directories(project)) {
        const path = await FrameLog.currentLog(sessionDirectory)
        if (path === undefined) continue
        const info = await stat(path, { bigint: true }).catch(() => undefined)
        if (info === undefined) continue
        const name = sessionDirectory.slice(sessionDirectory.lastIndexOf('/') + 1)
        logs.push({
          sessionId: name,
          path,
          size: Number(info.size),
          dev: String(info.dev),
          ino: String(info.ino),
          mtimeNs: String(info.mtimeNs),
          ctimeNs: String(info.ctimeNs),
        })
      }
    }
    return logs
  }

  static async #directories(path: string): Promise<readonly string[]> {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
    return entries.filter(entry => entry.isDirectory()).map(entry => `${path}/${entry.name}`)
  }
}
