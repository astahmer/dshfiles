import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { sha256Hex, WorkspaceWrite, type WorkspaceWriteRequest } from './workspace-write.js'

const TestLayer = WorkspaceWrite.layer.pipe(Layer.provideMerge(NodeServices.layer))

/** A temporary sandbox holding a `workspace` root with `src/` and a sibling `outside` directory. */
const sandbox = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'dshfiles-editor-' })
  const root = path.join(directory, 'workspace')
  const outside = path.join(directory, 'outside')
  yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
  yield* fs.makeDirectory(outside)
  const save = (overrides: Partial<WorkspaceWriteRequest> & Pick<WorkspaceWriteRequest, 'path'>) =>
    WorkspaceWrite.use(files => files.write({ root, text: 'next\n', expectedSha256: null, overwrite: false, maxBytes: 1024, ...overrides }))
  return { fs, path, directory, root, outside, save }
})

const shaOf = (text: string): string => sha256Hex(Buffer.from(text, 'utf8'))

describe('WorkspaceWrite', () => {
  it.layer(TestLayer)(it => {
    it.effect('creates a new file without leaving temp siblings', () =>
      Effect.gen(function* () {
        const { fs, path, root, save } = yield* sandbox
        expect(yield* save({ path: 'src/new.ts' })).toMatchObject({ status: 'saved', sha256: shaOf('next\n'), bytes: 5 })
        expect(yield* fs.readFileString(path.join(root, 'src/new.ts'))).toBe('next\n')
        expect(yield* fs.readDirectory(path.join(root, 'src'))).toEqual(['new.ts'])
      }),
    )

    it.effect('replaces a file whose disk content still matches what the editor loaded, keeping its mode', () =>
      Effect.gen(function* () {
        const { fs, path, root, save } = yield* sandbox
        const file = path.join(root, 'src/app.ts')
        yield* fs.writeFileString(file, 'before\n')
        yield* fs.chmod(file, 0o600)
        expect((yield* save({ path: file, expectedSha256: shaOf('before\n') })).status).toBe('saved')
        expect(yield* fs.readFileString(file)).toBe('next\n')
        expect((yield* fs.stat(file)).mode & 0o777).toBe(0o600)
      }),
    )

    it.effect('reports a conflict and leaves the file alone when it changed on disk', () =>
      Effect.gen(function* () {
        const { fs, path, root, save } = yield* sandbox
        const file = path.join(root, 'src/app.ts')
        yield* fs.writeFileString(file, 'agent edit\n')
        expect(yield* save({ path: 'src/app.ts', expectedSha256: shaOf('before\n') })).toEqual({ status: 'conflict', currentSha256: shaOf('agent edit\n') })
        expect(yield* fs.readFileString(file)).toBe('agent edit\n')
      }),
    )

    it.effect('reports a conflict when a file appeared where the editor expected none', () =>
      Effect.gen(function* () {
        const { fs, path, root, save } = yield* sandbox
        yield* fs.writeFileString(path.join(root, 'src/app.ts'), 'created meanwhile\n')
        expect((yield* save({ path: 'src/app.ts' })).status).toBe('conflict')
      }),
    )

    it.effect('overwrites a conflicting file once the user chose to', () =>
      Effect.gen(function* () {
        const { fs, path, root, save } = yield* sandbox
        yield* fs.writeFileString(path.join(root, 'src/app.ts'), 'agent edit\n')
        expect((yield* save({ path: 'src/app.ts', expectedSha256: shaOf('before\n'), overwrite: true })).status).toBe('saved')
        expect(yield* fs.readFileString(path.join(root, 'src/app.ts'))).toBe('next\n')
      }),
    )

    it.effect('refuses relative traversal and absolute paths outside the workspace', () =>
      Effect.gen(function* () {
        const { fs, path, outside, save } = yield* sandbox
        for (const target of ['../outside/escape.txt', 'src/../../outside/escape.txt', path.join(outside, 'escape.txt')]) {
          expect(yield* Effect.flip(save({ path: target }))).toMatchObject({
            _tag: 'WritePathOutsideWorkspace',
            message: 'Path is outside the session workspace.',
          })
        }
        expect(yield* fs.readDirectory(outside)).toEqual([])
      }),
    )

    it.effect('refuses a symlinked directory that leads outside the workspace', () =>
      Effect.gen(function* () {
        const { fs, path, root, outside, save } = yield* sandbox
        yield* fs.symlink(outside, path.join(root, 'linked'))
        expect((yield* Effect.flip(save({ path: 'linked/escape.txt' })))._tag).toBe('WritePathOutsideWorkspace')
        expect(yield* fs.readDirectory(outside)).toEqual([])
      }),
    )

    it.effect('refuses to replace a symlink even when it points inside the workspace', () =>
      Effect.gen(function* () {
        const { fs, path, root, outside, save } = yield* sandbox
        yield* fs.writeFileString(path.join(outside, 'secret.txt'), 'secret\n')
        yield* fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'src/link.txt'))
        expect((yield* Effect.flip(save({ path: 'src/link.txt', overwrite: true })))._tag).toBe('WriteTargetNotRegularFile')
        expect(yield* fs.readFileString(path.join(outside, 'secret.txt'))).toBe('secret\n')
      }),
    )

    it.effect('refuses directories, missing parents, oversized content and version-control internals', () =>
      Effect.gen(function* () {
        const { fs, path, root, save } = yield* sandbox
        const tagOf = (request: Parameters<typeof save>[0]) => Effect.map(Effect.flip(save(request)), error => error._tag)
        expect(yield* tagOf({ path: 'src', overwrite: true })).toBe('WriteTargetNotRegularFile')
        expect(yield* tagOf({ path: 'missing/file.ts' })).toBe('WriteParentMissing')
        expect(yield* Effect.flip(save({ path: 'src/big.txt', text: 'x'.repeat(1025) }))).toMatchObject({
          _tag: 'WriteTooLarge',
          message: 'File exceeds the 1024 byte save limit.',
        })
        yield* fs.makeDirectory(path.join(root, '.git'))
        expect(yield* tagOf({ path: '.git/config' })).toBe('WritePathProtected')
        expect(yield* tagOf({ path: '.' })).toBe('WritePathOutsideWorkspace')
        expect(yield* tagOf({ path: 'src/a\0b' })).toBe('WritePathInvalid')
      }),
    )

    it.effect('accepts a root reached through a symlinked prefix', () =>
      Effect.gen(function* () {
        const { fs, path, directory, root } = yield* sandbox
        yield* fs.symlink(root, path.join(directory, 'alias'))
        const result = yield* WorkspaceWrite.use(files =>
          files.write({
            root: path.join(directory, 'alias'),
            path: path.join(directory, 'alias/src/via-alias.ts'),
            text: 'ok',
            expectedSha256: null,
            overwrite: false,
            maxBytes: 1024,
          }),
        )
        expect(result.status).toBe('saved')
        expect(yield* fs.readFileString(path.join(root, 'src/via-alias.ts'))).toBe('ok')
      }),
    )
  })
})
