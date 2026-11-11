const ZSTD_MAGIC = 0xfd2fb528

/**
 * End offsets of the complete Zstandard frames in `buffer`; a torn final frame is left out. Shared with
 * `scripts/self-improve-log.ts`, so it imports nothing.
 */
export const completeZstdFrameEnds = (buffer: Buffer): number[] => {
  const ends: number[] = []
  let offset = 0
  while (offset + 5 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new RangeError(`not a Zstandard frame at byte ${String(offset)}`)
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
      const blockType = (header >>> 1) & 3
      cursor += blockType === 1 ? 1 : header >>> 3
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
