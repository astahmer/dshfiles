import { Effect, FileSystem, type PlatformError, Stream } from 'effect'

/** A record longer than this is skipped, not parsed: one pasted blob must not stall the Host loop. */
export const MAX_LINE_BYTES = 16 * 1024 * 1024
const CHUNK_SIZE = 64 * 1024
const NEWLINE = 0x0a

export interface LineRead {
  /** Byte offset just past the last complete line: an index resumes the file there. */
  readonly offset: number
  readonly lines: number
  readonly skipped: number
  readonly stopped: boolean
}

/**
 * Stream the complete lines of a JSONL file from a byte offset. A trailing partial line (a log still being written) is
 * left for the next read: the returned offset never passes it. `onLine` decodes the line itself and returns `false` to
 * stop the read early; blank and oversized lines are skipped.
 */
export const readLines = (input: {
  readonly path: string
  readonly offset: number
  readonly onLine: (line: string) => boolean | void
}): Effect.Effect<LineRead, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const decoder = new TextDecoder()
    let consumed = input.offset
    let pending: Uint8Array[] = []
    let pendingBytes = 0
    let oversized = false
    let lines = 0
    let skipped = 0
    let stopped = false

    const take = (piece: Uint8Array): void => {
      if (oversized) return
      if (pendingBytes + piece.length > MAX_LINE_BYTES) {
        oversized = true
        pending = []
        pendingBytes = 0
        return
      }
      pending.push(piece)
      pendingBytes += piece.length
    }

    const finishLine = (lineBytes: number): void => {
      consumed += lineBytes
      lines += 1
      if (oversized) {
        skipped += 1
      } else {
        const joined = pending.length === 1 ? (pending[0] ?? new Uint8Array()) : concat(pending, pendingBytes)
        const text = decoder.decode(joined)
        if (text.trim().length === 0) skipped += 1
        else if (input.onLine(text) === false) stopped = true
      }
      pending = []
      pendingBytes = 0
      oversized = false
    }

    let lineBytes = 0
    yield* fileSystem.stream(input.path, { offset: input.offset, chunkSize: CHUNK_SIZE }).pipe(
      Stream.takeWhile(() => !stopped),
      Stream.runForEach(chunk =>
        Effect.sync(() => {
          let start = 0
          while (!stopped) {
            const end = chunk.indexOf(NEWLINE, start)
            if (end === -1) {
              take(chunk.subarray(start))
              lineBytes += chunk.length - start
              return
            }
            take(chunk.subarray(start, end))
            lineBytes += end - start + 1
            finishLine(lineBytes)
            lineBytes = 0
            start = end + 1
          }
        }),
      ),
    )
    return { offset: consumed, lines, skipped, stopped }
  })

const concat = (pieces: readonly Uint8Array[], total: number): Uint8Array => {
  const joined = new Uint8Array(total)
  let at = 0
  for (const piece of pieces) {
    joined.set(piece, at)
    at += piece.length
  }
  return joined
}
