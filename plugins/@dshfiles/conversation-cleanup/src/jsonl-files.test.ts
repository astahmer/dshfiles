import { stat } from 'node:fs/promises'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'

import { jsonlSessionDirectory, purgeJsonlFiles } from './jsonl-files.js'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
const purge = Effect.fnUntraced(function* (input: Omit<Parameters<typeof purgeJsonlFiles>[0], 'expectedRevision'>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* jsonlSessionDirectory(input)
  const plain = path.join(directory, 'session.v4.jsonl')
  const current = (yield* fs.exists(plain)) ? plain : path.join(directory, 'session.v4.jsonl.zstd')
  const identity = (yield* fs.exists(current)) ? yield* Effect.promise(() => stat(current, { bigint: true })) : undefined
  const expectedRevision = identity === undefined ? '' : [identity.dev, identity.ino, identity.size, identity.mtimeNs, identity.ctimeNs].join(':')
  return yield* purgeJsonlFiles({ ...input, expectedRevision })
})
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'conversation-jsonl-' }))
  const input = { root, cwd: '/projects/example', sessionId: 'session-example' }
  const directory = yield* jsonlSessionDirectory(input)
  yield* fs.makeDirectory(directory, { recursive: true })
  return { fs, path, root, input, directory }
})

describe('JSONL file purge', () => {
  it.layer(platform)(it => {
    it.effect('removes all canonical generations and encodings, retaining lock inode and sidecars', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const logs = ['session.jsonl', 'session.v1.jsonl.zstd', 'session.v3.jsonl', 'session.v4.jsonl.zstd']
        const retained = ['session.lock', 'session.v04.jsonl', 'session.v0.jsonl', 'session.v4.jsonl.tmp', 'notes.txt']
        for (const name of [...logs, ...retained]) yield* test.fs.writeFileString(test.path.join(test.directory, name), name)
        const lock = yield* test.fs.lstat(test.path.join(test.directory, 'session.lock'))
        expect(yield* purge(test.input)).toBe(logs.length)
        expect((yield* test.fs.readDirectory(test.directory)).sort()).toEqual(retained.sort())
        expect((yield* test.fs.lstat(test.path.join(test.directory, 'session.lock'))).ino).toEqual(lock.ino)
        expect((yield* test.fs.lstat(test.directory)).type).toBe('Directory')
      }).pipe(Effect.scoped),
    )

    it.effect('encodes malicious identities and project paths without escaping the root', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        for (const sessionId of ['../escape', '/absolute', '..', '.', '~002E', '\u0000', '\ud800']) {
          const input = { root: test.root, cwd: '../../outside:/\\', sessionId }
          const directory = yield* jsonlSessionDirectory(input)
          expect(test.path.dirname(test.path.dirname(directory))).toBe(test.root)
          yield* test.fs.makeDirectory(directory, { recursive: true })
          yield* test.fs.writeFileString(test.path.join(directory, 'session.v4.jsonl'), 'log')
          expect(yield* purge(input)).toBe(1)
        }
        expect(yield* jsonlSessionDirectory({ root: test.root, cwd: 'C:\\Users\\name', sessionId: 'a~b' })).toBe(
          test.path.join(test.root, '--C-Users-name--', 'a~007Eb'),
        )
        expect(yield* jsonlSessionDirectory({ root: test.root, sessionId: 'plain' })).toBe(test.path.join(test.root, '_no-cwd', 'plain'))
      }).pipe(Effect.scoped),
    )

    it.effect('refuses empty identities, empty projects and non-specific roots', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        for (const input of [
          { root: test.root, sessionId: '' },
          { root: test.root, sessionId: 'id', cwd: '' },
          { root: '/', sessionId: 'id' },
          { root: 'relative', sessionId: 'id' },
        ])
          expect((yield* Effect.flip(jsonlSessionDirectory(input)))._tag).toBe('JsonlPurgeRefused')
      }).pipe(Effect.scoped),
    )

    it.effect('validates every file before deleting any and refuses future generations', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const old = test.path.join(test.directory, 'session.jsonl')
        yield* test.fs.writeFileString(old, 'retained')
        yield* test.fs.writeFileString(test.path.join(test.directory, 'session.v5.jsonl'), 'future')
        expect((yield* Effect.flip(purge(test.input)))._tag).toBe('JsonlPurgeRefused')
        expect(yield* test.fs.readFileString(old)).toBe('retained')
      }).pipe(Effect.scoped),
    )

    it.effect('refuses symlinked canonical files without touching their targets or older logs', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const outside = test.path.join(test.root, 'outside')
        yield* test.fs.writeFileString(outside, 'safe')
        yield* test.fs.writeFileString(test.path.join(test.directory, 'session.jsonl'), 'old')
        yield* test.fs.symlink(outside, test.path.join(test.directory, 'session.v4.jsonl'))
        expect((yield* Effect.flip(purge(test.input)))._tag).toBe('JsonlPurgeRefused')
        expect(yield* test.fs.readFileString(outside)).toBe('safe')
        expect(yield* test.fs.readFileString(test.path.join(test.directory, 'session.jsonl'))).toBe('old')
      }).pipe(Effect.scoped),
    )

    it.effect('refuses root, project and session directory symlinks', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const linkedRoot = `${test.root}-link`
        yield* Effect.acquireRelease(test.fs.symlink(test.root, linkedRoot), () => test.fs.remove(linkedRoot).pipe(Effect.orDie))
        expect((yield* Effect.flip(purge({ ...test.input, root: linkedRoot })))._tag).toBe('JsonlPurgeRefused')
        const outside = test.path.join(test.root, 'outside')
        yield* test.fs.makeDirectory(outside)
        const sessionLink = yield* jsonlSessionDirectory({ ...test.input, sessionId: 'linked' })
        yield* test.fs.symlink(outside, sessionLink)
        expect((yield* Effect.flip(purge({ ...test.input, sessionId: 'linked' })))._tag).toBe('JsonlPurgeRefused')
        const projectInput = { ...test.input, cwd: '/linked-project' }
        const projectDirectory = test.path.dirname(yield* jsonlSessionDirectory(projectInput))
        yield* test.fs.symlink(outside, projectDirectory)
        yield* test.fs.makeDirectory(test.path.join(outside, test.input.sessionId))
        expect((yield* Effect.flip(purge(projectInput)))._tag).toBe('JsonlPurgeRefused')
      }).pipe(Effect.scoped),
    )

    it.effect('refuses physical revision mismatches and ambiguous current encodings before deletion', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const current = test.path.join(test.directory, 'session.v4.jsonl')
        yield* test.fs.writeFileString(current, 'current')
        yield* test.fs.writeFileString(test.path.join(test.directory, 'session.jsonl'), 'historical')
        expect((yield* Effect.flip(purgeJsonlFiles({ ...test.input, expectedRevision: 'different-physical-file' })))._tag).toBe('JsonlPurgeRefused')
        expect(yield* test.fs.readFileString(current)).toBe('current')
        yield* test.fs.writeFileString(test.path.join(test.directory, 'session.v4.jsonl.zstd'), 'ambiguous')
        expect((yield* Effect.flip(purge(test.input)))._tag).toBe('JsonlPurgeRefused')
        expect((yield* test.fs.readDirectory(test.directory)).length).toBe(3)
      }).pipe(Effect.scoped),
    )

    it.effect('refuses log-shaped directories and an empty canonical inventory', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        expect((yield* Effect.flip(purge(test.input)))._tag).toBe('JsonlPurgeRefused')
        yield* test.fs.makeDirectory(test.path.join(test.directory, 'session.v4.jsonl'))
        expect((yield* Effect.flip(purge(test.input)))._tag).toBe('JsonlPurgeRefused')
        expect((yield* test.fs.lstat(test.path.join(test.directory, 'session.v4.jsonl'))).type).toBe('Directory')
      }).pipe(Effect.scoped),
    )
  })
})
