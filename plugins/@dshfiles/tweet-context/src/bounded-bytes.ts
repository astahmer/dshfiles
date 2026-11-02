import { Effect, Stream } from 'effect'

/** Collect a byte stream, failing as soon as it grows past `maxBytes` so an oversized body or pipe is never buffered whole. */
export const boundedBytes = <E, Overflow>(input: {
  readonly stream: Stream.Stream<Uint8Array, E>
  readonly maxBytes: number
  readonly onOverflow: () => Overflow
}): Effect.Effect<Uint8Array, E | Overflow> =>
  Effect.map(
    Stream.runFoldEffect(
      input.stream,
      (): { readonly chunks: ReadonlyArray<Uint8Array>; readonly bytes: number } => ({ chunks: [], bytes: 0 }),
      (collected, chunk) => {
        const bytes = collected.bytes + chunk.byteLength
        if (bytes > input.maxBytes) return Effect.fail(input.onOverflow())
        return Effect.succeed({ chunks: [...collected.chunks, chunk], bytes })
      },
    ),
    collected => Buffer.concat(collected.chunks),
  )
