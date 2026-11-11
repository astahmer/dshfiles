import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jjSettingsTest } from './jj-settings.js'
import { ThreadMetadata } from './thread-metadata.js'

const layer = ThreadMetadata.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, jjSettingsTest())))
const run = <A, E>(effect: Effect.Effect<A, E, ThreadMetadata>) => Effect.runPromise(Effect.provide(effect, layer))
const noIds = { tipChangeId: undefined, baseChangeId: undefined, sessionId: undefined }

describe('thread land metadata', () => {
  let root: string
  let repoRoot: string
  let file: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'thread-metadata-'))
    repoRoot = join(root, 'repo')
    mkdirSync(`${repoRoot}-threads`, { recursive: true })
    file = join(`${repoRoot}-threads`, '.dshfiles-rebase-timestamps.json')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('keeps the valid entries of a file with one bad entry, and preserves the bad one when recording', async () => {
    writeFileSync(file, JSON.stringify({ 'thread-aaaaaa': { at: 1 }, 'thread-bbbbbb': { at: 'not-a-number' } }))
    expect(await run(ThreadMetadata.use(metadata => metadata.read(repoRoot)))).toEqual({ 'thread-aaaaaa': { at: 1 } })
    await run(ThreadMetadata.use(metadata => metadata.record(repoRoot, 'thread-cccccc', noIds)))
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(Object.keys(written).sort()).toEqual(['thread-aaaaaa', 'thread-bbbbbb', 'thread-cccccc'])
    expect(written['thread-bbbbbb']).toEqual({ at: 'not-a-number' })
  })

  it('refuses to overwrite a file that does not decode', async () => {
    writeFileSync(file, '{"thread-aaaaaa": {"at": 1},')
    await expect(run(ThreadMetadata.use(metadata => metadata.record(repoRoot, 'thread-cccccc', noIds)))).rejects.toThrow()
    expect(readFileSync(file, 'utf8')).toBe('{"thread-aaaaaa": {"at": 1},')
  })

  it('keeps every concurrent record', async () => {
    const names = Array.from({ length: 8 }, (_, index) => `thread-00000${index}`)
    await run(
      Effect.all(
        names.map(name => ThreadMetadata.use(metadata => metadata.record(repoRoot, name, noIds))),
        { concurrency: 'unbounded' },
      ),
    )
    expect(Object.keys(await run(ThreadMetadata.use(metadata => metadata.read(repoRoot)))).sort()).toEqual(names)
  })
})
