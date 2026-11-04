import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { MarkdownDocuments } from './markdown-documents.js'

const TestLayer = MarkdownDocuments.layer.pipe(Layer.provideMerge(NodeServices.layer))

const workspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const workspacePath = yield* fs.makeTempDirectoryScoped({ prefix: 'dsh-markdown-feedback-' })
  return { fs, path, workspacePath }
})

describe('Markdown feedback anchors', () => {
  it.layer(TestLayer)(it => {
    it.effect('captures exact workspace lines against the whole-file revision', () =>
      Effect.gen(function* () {
        const { fs, path, workspacePath } = yield* workspace
        yield* fs.makeDirectory(path.join(workspacePath, 'docs'))
        yield* fs.writeFileString(path.join(workspacePath, 'docs/guide.md'), '# Guide\n\nKeep this section.\n')
        const documents = yield* MarkdownDocuments
        const anchor = yield* documents.captureAnchor({ workspacePath, path: 'docs/guide.md', startLine: 3, endLine: 3, selectedText: 'Keep this section.' })
        expect(anchor).toMatchObject({ kind: 'markdown', path: 'docs/guide.md', startLine: 3, endLine: 3, excerpt: 'Keep this section.' })
        expect(anchor.revision).toMatch(/^[a-f0-9]{64}$/)
        expect(yield* documents.currentRevision({ workspacePath, path: anchor.path })).toBe(anchor.revision)
      }),
    )

    it.effect('rejects traversal, symlinks, and a quote that does not match the source lines', () =>
      Effect.gen(function* () {
        const { fs, path, workspacePath } = yield* workspace
        const outsidePath = path.join(workspacePath, 'outside.md')
        yield* fs.writeFileString(outsidePath, 'private')
        yield* fs.symlink(outsidePath, path.join(workspacePath, 'linked.md'))
        yield* fs.writeFileString(path.join(workspacePath, 'guide.md'), '# Guide\n')
        const documents = yield* MarkdownDocuments
        const anchor = (input: { readonly path: string; readonly selectedText: string }) =>
          Effect.flip(documents.captureAnchor({ workspacePath, startLine: 1, endLine: 1, ...input }))
        expect(yield* anchor({ path: '../outside.md', selectedText: 'private' })).toMatchObject({ reason: 'invalid-path' })
        expect((yield* anchor({ path: 'linked.md', selectedText: 'private' })).message).toMatch(/symlinks/)
        expect((yield* anchor({ path: 'guide.md', selectedText: 'changed text' })).message).toMatch(/does not match/)
        expect((yield* Effect.flip(documents.captureAnchor({ workspacePath, path: 'guide.md', startLine: 3, endLine: 1, selectedText: 'x' }))).message).toBe(
          'Markdown feedback anchors must cover at most 200 ordered lines.',
        )
      }),
    )

    it.effect('returns no revision after the document is removed or becomes unsafe', () =>
      Effect.gen(function* () {
        const { fs, path, workspacePath } = yield* workspace
        const guide = path.join(workspacePath, 'guide.md')
        yield* fs.writeFileString(guide, '# Guide\n')
        const documents = yield* MarkdownDocuments
        expect(yield* documents.currentRevision({ workspacePath, path: 'guide.md' })).not.toBeNull()
        yield* fs.remove(guide)
        expect(yield* documents.currentRevision({ workspacePath, path: 'guide.md' })).toBeNull()
      }),
    )
  })
})
