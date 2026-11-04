import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem } from 'effect'
import { readPreview } from '../src/preview.js'

const root = FileSystem.FileSystem.use(fileSystem => fileSystem.makeTempDirectoryScoped({ prefix: 'dsh-preview-' }))
const write = (path: string, text: string) => FileSystem.FileSystem.use(fileSystem => fileSystem.writeFileString(path, text))

describe('readPreview', () => {
  it.layer(NodeFileSystem.layer)(it => {
    it.effect('reads an html file inside the root', () =>
      Effect.gen(function* () {
        const base = yield* root
        yield* write(join(base, 'page.html'), '<p>hi</p>')
        expect(yield* readPreview({ root: base, path: 'page.html' })).toEqual({ ok: true, value: { path: 'page.html', html: '<p>hi</p>', truncated: false } })
      }).pipe(Effect.scoped),
    )

    it.effect('refuses a path outside the root and another file type', () =>
      Effect.gen(function* () {
        const base = yield* root
        yield* write(join(base, 'notes.md'), '# hi')
        expect(yield* readPreview({ root: base, path: '../escape.html' })).toEqual({ ok: false, error: 'outside-workspace' })
        expect(yield* readPreview({ root: base, path: 'notes.md' })).toEqual({ ok: false, error: 'unsupported' })
      }).pipe(Effect.scoped),
    )

    it.effect('reports a missing file', () =>
      Effect.gen(function* () {
        const base = yield* root
        yield* FileSystem.FileSystem.use(fileSystem => fileSystem.makeDirectory(join(base, 'sub'), { recursive: true }))
        expect(yield* readPreview({ root: base, path: 'sub/missing.html' })).toEqual({ ok: false, error: 'missing' })
      }).pipe(Effect.scoped),
    )

    it.effect('records the preview read span', () =>
      Effect.gen(function* () {
        const base = yield* root
        yield* write(join(base, 'page.html'), '<p>hi</p>')
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          spans => Effect.sync(() => spans[Symbol.dispose]()),
        )
        yield* readPreview({ root: base, path: 'page.html' })
        expect(recorder.span('annotations read preview')).toBeDefined()
      }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
    )
  })
})
