import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path, Schema } from 'effect'
import { whiteboardApi } from '../src/api.js'
import { boardSchema, boardSummarySchema } from '../src/model.js'
import { mount, mountedWhiteboard, platformLayer, requestApi, tool } from './host-layers.js'

const project = '/projects/sample'
const other = '/projects/other'
const rectangle = { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 }
const label = { id: 't1', type: 'text', x: 10, y: 10, text: 'Hello board', originalText: 'Hello board' }
const deletedLabel = { id: 't2', type: 'text', x: 10, y: 80, text: 'gone', isDeleted: true }
const decodeSummary = Schema.decodeUnknownEffect(boardSummarySchema)
const decodeBoard = Schema.decodeUnknownEffect(boardSchema)

describe('whiteboard store through the public API', () => {
  it.effect('creates, lists per project, reads, updates with revisions, renames, deletes and restores', () =>
    Effect.gen(function* () {
      const { client, home } = yield* mountedWhiteboard
      const created = yield* Effect.promise(() => client.write({ project, title: 'Architecture' }))
      expect(created).toMatchObject({ project, title: 'Architecture', revision: 1, elementCount: 0, pending: null, deletedAt: null })
      yield* Effect.promise(() => client.write({ project: other, title: 'Elsewhere' }))
      expect((yield* Effect.promise(() => client.list({ project }))).boards.map(board => board.title)).toEqual(['Architecture'])
      expect((yield* Effect.promise(() => client.list({}))).boards).toHaveLength(2)

      const drawn = yield* Effect.promise(() =>
        client.write({ boardId: created.id, expectedRevision: 1, elements: [rectangle, label, deletedLabel], appState: { viewBackgroundColor: '#fafafa' } }),
      )
      expect(drawn).toMatchObject({ revision: 2, elementCount: 2 })
      const read = yield* Effect.promise(() => client.read({ boardId: created.id }))
      expect(read.scene.elements).toHaveLength(3)
      expect(read.scene.appState).toEqual({ viewBackgroundColor: '#fafafa' })
      expect(read.texts).toEqual(['Hello board'])

      yield* Effect.promise(() =>
        expect(client.write({ boardId: created.id, expectedRevision: 1, elements: [] })).rejects.toMatchObject({ remoteCode: 'stale-revision' }),
      )
      yield* Effect.promise(() => expect(client.write({ boardId: created.id, elements: [] })).rejects.toMatchObject({ remoteCode: 'invalid-write' }))
      expect((yield* Effect.promise(() => client.read({ boardId: created.id }))).scene.elements).toHaveLength(3)

      const renamed = yield* Effect.promise(() => client.rename({ boardId: created.id, expectedRevision: 2, title: 'System map' }))
      expect(renamed).toMatchObject({ title: 'System map', revision: 3 })

      const deleted = yield* Effect.promise(() => client.delete({ boardId: created.id, confirm: true }))
      expect(deleted.deletedAt).not.toBeNull()
      expect((yield* Effect.promise(() => client.list({ project }))).boards).toEqual([])
      expect((yield* Effect.promise(() => client.list({ project, includeDeleted: true }))).boards.map(board => board.id)).toEqual([created.id])
      yield* Effect.promise(() =>
        expect(client.write({ boardId: created.id, expectedRevision: deleted.revision, title: 'x' })).rejects.toMatchObject({ remoteCode: 'board-deleted' }),
      )
      const restored = yield* Effect.promise(() => client.restore({ boardId: created.id }))
      expect(restored).toMatchObject({ deletedAt: null, title: 'System map', elementCount: 2 })
      expect((yield* Effect.promise(() => client.read({ boardId: created.id }))).scene.elements).toHaveLength(3)

      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const database = path.join(home, 'plugins', 'whiteboard', 'boards.db')
      expect(yield* fs.exists(database)).toBe(true)
      expect(((yield* fs.stat(path.dirname(database))).mode & 0o777).toString(8)).toBe('700')
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('queues Mermaid or skeleton source until the editor converts and clears it', () =>
    Effect.gen(function* () {
      const { client } = yield* mountedWhiteboard
      const board = yield* Effect.promise(() => client.write({ project, title: 'Flow', mermaid: 'flowchart TD\n  A --> B' }))
      expect(board.pending).toBe('mermaid')
      expect((yield* Effect.promise(() => client.read({ boardId: board.id }))).pending).toEqual({ kind: 'mermaid', source: 'flowchart TD\n  A --> B' })
      yield* Effect.promise(() =>
        expect(client.write({ boardId: board.id, expectedRevision: 1, mermaid: 'graph TD', skeleton: [rectangle] })).rejects.toMatchObject({
          remoteCode: 'invalid-write',
        }),
      )
      const replaced = yield* Effect.promise(() => client.write({ boardId: board.id, expectedRevision: 1, skeleton: [{ type: 'rectangle', x: 0, y: 0 }] }))
      expect(replaced.pending).toBe('skeleton')
      const converted = yield* Effect.promise(() => client.write({ boardId: board.id, expectedRevision: 2, elements: [rectangle], clearPending: true }))
      expect(converted).toMatchObject({ pending: null, elementCount: 1, revision: 3 })
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('refuses an oversized scene and an unknown board without changing anything', () =>
    Effect.gen(function* () {
      const { client } = yield* mountedWhiteboard
      const board = yield* Effect.promise(() => client.write({ project, title: 'Big' }))
      const huge = { image: { id: 'image', mimeType: 'image/png', dataURL: `data:image/png;base64,${'A'.repeat(920 * 1024)}` } }
      yield* Effect.promise(() =>
        expect(client.write({ boardId: board.id, expectedRevision: 1, files: huge })).rejects.toMatchObject({ remoteCode: 'invalid-write' }),
      )
      expect((yield* Effect.promise(() => client.read({ boardId: board.id }))).board.revision).toBe(1)
      yield* Effect.promise(() => expect(client.read({ boardId: crypto.randomUUID() })).rejects.toMatchObject({ remoteCode: 'unknown-board' }))
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('keeps boards across a plugin reload', () =>
    Effect.gen(function* () {
      const { host, mounted, client } = yield* mountedWhiteboard
      const board = yield* Effect.promise(() => client.write({ project, title: 'Durable', elements: [rectangle] }))
      yield* Effect.promise(() => mounted.dispose())
      yield* Effect.promise(() => expect(client.list({})).rejects.toMatchObject({ remoteCode: 'owner-missing' }))
      yield* mount(host)
      expect((yield* Effect.promise(() => client.read({ boardId: board.id }))).scene.elements).toEqual([rectangle])
    }).pipe(Effect.provide(platformLayer)),
  )
})

describe('agent tools', () => {
  it.effect('binds every method as a tool; reads are read-only and delete needs confirm: true', () =>
    Effect.gen(function* () {
      const { host } = yield* mountedWhiteboard
      const schemas = host.tools.schemas()
      const names = Object.values(whiteboardApi.methods).map(method => method.tool?.name)
      expect(names).toEqual(['whiteboard_list', 'whiteboard_read', 'whiteboard_write', 'whiteboard_rename', 'whiteboard_delete', 'whiteboard_restore'])
      for (const name of names) expect(schemas.some(schema => schema.name === name)).toBe(true)
      for (const name of ['whiteboard_list', 'whiteboard_read']) expect(host.tools.get(name)?.isConcurrencySafe).toBeDefined()
      for (const name of ['whiteboard_write', 'whiteboard_rename', 'whiteboard_delete', 'whiteboard_restore'])
        expect(host.tools.get(name)?.isConcurrencySafe).toBeUndefined()
      expect(schemas.find(schema => schema.name === 'whiteboard_delete')?.parameters).toMatchObject({
        required: expect.arrayContaining(['boardId', 'confirm']),
      })

      const written = yield* tool(host, 'whiteboard_write', { project, title: 'From an agent', mermaid: 'flowchart LR\n  idea --> plan' })
      if (written.isError) throw new Error('whiteboard_write failed')
      const board = yield* decodeSummary(written.value)
      const listed = yield* tool(host, 'whiteboard_list', { project })
      expect(listed.isError).toBe(false)
      const read = yield* tool(host, 'whiteboard_read', { boardId: board.id })
      if (read.isError) throw new Error('whiteboard_read failed')
      expect((yield* decodeBoard(read.value)).pending).toMatchObject({ kind: 'mermaid' })

      for (const args of [{ boardId: board.id }, { boardId: board.id, confirm: false }]) {
        expect(yield* requestApi(host, 'delete', args)).toMatchObject({ result: { ok: false, error: { code: 'contract' } } })
        expect((yield* tool(host, 'whiteboard_delete', args)).isError).toBe(true)
      }
      expect((yield* tool(host, 'whiteboard_delete', { boardId: board.id, confirm: true })).isError).toBe(false)
      expect((yield* tool(host, 'whiteboard_restore', { boardId: board.id })).isError).toBe(false)
      expect(yield* requestApi(host, 'write', { project: 'relative/path', title: 'x' })).toMatchObject({ result: { ok: false, error: { code: 'contract' } } })
    }).pipe(Effect.provide(platformLayer)),
  )
})
