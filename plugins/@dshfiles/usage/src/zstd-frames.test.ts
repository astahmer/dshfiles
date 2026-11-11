import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { completeZstdFrameEnds } from './zstd-frames.js'

const frame = (text: string) => zstdCompressSync(Buffer.from(text))

describe('completeZstdFrameEnds', () => {
  it('ends at each complete frame and leaves a torn final frame out', () => {
    const first = frame('{"type":"a"}\n')
    const second = frame('{"type":"b"}\n')
    const torn = frame('{"type":"c"}\n').subarray(0, 6)

    expect(completeZstdFrameEnds(Buffer.concat([first, second, torn]))).toEqual([first.length, first.length + second.length])
  })

  it('refuses bytes that are not a Zstandard frame', () => {
    expect(() => completeZstdFrameEnds(Buffer.from('not a zstd frame'))).toThrow(RangeError)
  })
})
