import { gunzipSync, gzipSync } from 'node:zlib'
import { Effect, Schema } from 'effect'
import { bundleSchema, type ThreadBundle } from './bundle.js'

/** The largest bundle this plugin reads or writes, uncompressed: enough for long threads with many screenshots. */
export const MAX_BUNDLE_BYTES = 512 * 1024 * 1024

export class BundleUnreadable extends Schema.TaggedError<BundleUnreadable>()(
  'BundleUnreadable',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'bundle-unreadable' },
) {
  override get message(): string {
    return `${this.reason} Pick a .dshthread file exported by DSH, or export the thread again.`
  }
}

const GZIP_MAGIC = [0x1f, 0x8b] as const
const decodeDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(bundleSchema))

/** The file bytes of a bundle: gzip of its JSON document. */
export const encodeBundle = (bundle: ThreadBundle): Effect.Effect<Uint8Array, BundleUnreadable> =>
  Effect.try({
    try: () => {
      const json = Buffer.from(JSON.stringify(bundle), 'utf8')
      if (json.byteLength > MAX_BUNDLE_BYTES) throw new RangeError('too large')
      return new Uint8Array(gzipSync(json, { level: 6 }))
    },
    catch: cause =>
      new BundleUnreadable({
        reason: `This thread is larger than the ${String(MAX_BUNDLE_BYTES / 1024 / 1024)} MiB a bundle may hold.`,
        cause,
      }),
  })

/** Read a bundle from its file bytes; a plain (uncompressed) JSON document is accepted too. */
export const decodeBundle = (bytes: Uint8Array): Effect.Effect<ThreadBundle, BundleUnreadable> =>
  Effect.gen(function* () {
    const gzipped = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]
    const text = yield* Effect.try({
      try: () => (gzipped ? gunzipSync(bytes, { maxOutputLength: MAX_BUNDLE_BYTES }) : Buffer.from(bytes)).toString('utf8'),
      catch: cause => new BundleUnreadable({ reason: 'The file is not a readable thread bundle (it could not be decompressed).', cause }),
    })
    return yield* decodeDocument(text).pipe(
      Effect.mapError(cause => new BundleUnreadable({ reason: 'The file is not a thread bundle, or it was written by an unknown version.', cause })),
    )
  })
