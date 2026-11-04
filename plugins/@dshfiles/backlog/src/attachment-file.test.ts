import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'

import { AttachmentExport } from './attachment-file.js'

const dataUrl = (mediaType: string, text: string): string => `data:${mediaType};base64,${Buffer.from(text).toString('base64')}`

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** An export rooted in a fresh temporary directory, removed with the test scope. */
const scratchExport = Effect.gen(function* () {
  const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'backlog-attachment-test-' })
  return yield* Effect.provide(AttachmentExport, AttachmentExport.layerAt(root).pipe(Layer.provide(platform)))
})

describe('attachment files', () => {
  it.layer(platform)(it => {
    it.effect('writes the bytes under the two ids with an extension from the media type', () =>
      Effect.gen(function* () {
        const files = yield* scratchExport
        const path = yield* files.write({ id: 12, attachmentId: 'abc-def-123', dataUrl: dataUrl('image/webp', 'webp-bytes') })
        expect(path.endsWith('12-abc-def-123.webp')).toBe(true)
        expect(yield* (yield* FileSystem.FileSystem).readFileString(path)).toBe('webp-bytes')
      }).pipe(Effect.scoped),
    )

    it.effect('maps text and unknown media types to a usable extension', () =>
      Effect.gen(function* () {
        const files = yield* scratchExport
        expect((yield* files.write({ id: 1, attachmentId: 'text-one', dataUrl: dataUrl('text/plain', 'hello') })).endsWith('.txt')).toBe(true)
        expect((yield* files.write({ id: 1, attachmentId: 'binary-one', dataUrl: dataUrl('application/x-thing', 'bytes') })).endsWith('.xthing')).toBe(true)
      }).pipe(Effect.scoped),
    )

    it.effect('refuses a value that is not a base64 data URL', () =>
      Effect.gen(function* () {
        const files = yield* scratchExport
        const error = yield* Effect.flip(files.write({ id: 1, attachmentId: 'bad-one', dataUrl: 'not-a-data-url' }))
        expect(error._tag).toBe('AttachmentExportFailed')
        expect(error.attachmentId).toBe('bad-one')
      }).pipe(Effect.scoped),
    )
  })
})
