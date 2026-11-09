import { open, stat } from 'node:fs/promises'

const ZSTD_MAGIC = 0xfd2fb528
const ZSTD_MAGIC_BYTES = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** One independently decodable Zstandard frame inside a session log's byte window. */
export interface FrameRange {
  readonly start: number
  readonly end: number
}

/** Byte length of one log file; `undefined` when it cannot be stat'ed. */
export const fileSizeOf = async (path: string): Promise<number | undefined> => {
  const info = await stat(path, { bigint: true }).catch(() => undefined)
  return info === undefined ? undefined : Number(info.size)
}

/** Size, modification time and inode: an append or a rewrite changes it, so a kept window is never served stale. */
export const fileIdentityOf = async (path: string): Promise<string | undefined> => {
  const info = await stat(path, { bigint: true }).catch(() => undefined)
  return info === undefined ? undefined : `${String(info.ino)}:${String(info.size)}:${String(info.mtimeNs)}`
}

/** Read the last `windowBytes` of the file, or `undefined` when the file is shorter than the size just measured. */
export const readFileWindow = async (input: {
  readonly path: string
  readonly sizeBytes: number
  readonly windowBytes: number
  readonly signal: AbortSignal
}): Promise<Buffer | undefined> => {
  const start = Math.max(0, input.sizeBytes - input.windowBytes)
  const length = input.sizeBytes - start
  input.signal.throwIfAborted()
  const handle = await open(input.path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    let filled = 0
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled)
      if (bytesRead === 0) break
      filled += bytesRead
      input.signal.throwIfAborted()
    }
    return filled === length ? buffer : undefined
  } finally {
    await handle.close()
  }
}

/** Read the first `windowBytes` of the file, or the whole (shorter) file; `undefined` when it shrank mid-read. */
export const readFileHead = async (input: {
  readonly path: string
  readonly sizeBytes: number
  readonly windowBytes: number
  readonly signal: AbortSignal
}): Promise<Buffer | undefined> => {
  const length = Math.min(input.sizeBytes, input.windowBytes)
  input.signal.throwIfAborted()
  const handle = await open(input.path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    let filled = 0
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, filled)
      if (bytesRead === 0) break
      filled += bytesRead
      input.signal.throwIfAborted()
    }
    return filled === length ? buffer : undefined
  } finally {
    await handle.close()
  }
}

/** End offset of the frame starting at `start`, or `undefined` when the buffer ends inside it (a torn append). */
export const frameEndAt = (buffer: Buffer, start: number): number | undefined => {
  let offset = start
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
  return offset > buffer.length ? undefined : offset
}

/**
 * Complete frame ranges from `start`, or `undefined` when the buffer ends inside a frame (a torn append the full read
 * repairs).
 */
export const scanFrames = (buffer: Buffer, start = 0): readonly FrameRange[] | undefined => {
  const frames: FrameRange[] = []
  let offset = start
  while (offset < buffer.length) {
    const end = frameEndAt(buffer, offset)
    if (end === undefined) return undefined
    frames.push({ start: offset, end })
    offset = end
  }
  return frames
}

/**
 * Complete frame ranges from the start of a window that may end inside its last frame: the frames that parse
 * completely, `undefined` when not even the first one does.
 */
export const scanFramesPrefix = (buffer: Buffer): readonly FrameRange[] | undefined => {
  const frames: FrameRange[] = []
  let offset = 0
  for (;;) {
    const end = frameEndAt(buffer, offset)
    if (end === undefined) return frames.length === 0 ? undefined : frames
    frames.push({ start: offset, end })
    offset = end
  }
}

/** Frames of a buffer that may start mid-frame: the first magic that parses completely to the end wins. */
export const scanWindowFrames = (buffer: Buffer): readonly FrameRange[] | undefined => {
  for (let offset = buffer.indexOf(ZSTD_MAGIC_BYTES); offset !== -1; offset = buffer.indexOf(ZSTD_MAGIC_BYTES, offset + 1)) {
    const frames = scanFrames(buffer, offset)
    if (frames !== undefined) return frames
  }
  return undefined
}
