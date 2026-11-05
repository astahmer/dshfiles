import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogExport } from './backlog-export.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const

const open = () =>
  Effect.map(
    Layer.build(
      BacklogExport.layer.pipe(
        Layer.provideMerge(backlogStoreLayer({ rows: backlogRows() })),
        Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
      ),
    ),
    context => ({ store: Context.get(context, BacklogStore), exporter: Context.get(context, BacklogExport) }),
  )

const exportLine = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literals(['item', 'op']),
    itemId: Schema.String,
    ref: Schema.optional(Schema.String),
    item: Schema.optional(Schema.Struct({ title: Schema.String, status: Schema.String })),
    op: Schema.optional(Schema.Struct({ kind: Schema.String })),
  }),
)
const linesOf = (path: string) =>
  readFileSync(path, 'utf8')
    .trimEnd()
    .split('\n')
    .map(line => Schema.decodeUnknownSync(exportLine)(line))

const scratch = (): string => mkdtempSync(join(tmpdir(), 'dshfiles-backlog-export-'))

describe('backlog export', () => {
  it.effect('writes JSONL with one folded item per line, then the op log on request, and one bounded span', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      yield* TestClock.setTime(1_000)
      const { store, exporter } = yield* open()
      const first = yield* store.capture({ text: 'export me #ops', actor: user })
      yield* store.capture({ text: 'and me', actor: user })
      yield* store.update({ id: first.item.id, status: 'doing', actor: user })
      const directory = scratch()

      const items = yield* exporter.run({ path: join(directory, 'items.jsonl'), format: 'jsonl' })
      const lines = linesOf(items.path)
      expect(items).toMatchObject({ format: 'jsonl', items: 2, ops: 0 })
      expect(lines).toHaveLength(2)
      expect(lines.map(line => [line.type, line.ref, line.item?.title])).toEqual(
        expect.arrayContaining([
          ['item', first.item.ref, 'export me'],
          ['item', expect.stringMatching(/^[0-9a-z]{4}$/u), 'and me'],
        ]),
      )
      expect(lines.find(line => line.ref === first.item.ref)?.item?.status).toBe('doing')
      expect(lines[0]?.itemId).toMatch(/^[0-9A-Z]{26}$/u)

      const withOps = yield* exporter.run({ path: join(directory, 'all.jsonl'), format: 'jsonl', includeOps: true })
      const all = linesOf(withOps.path)
      expect(withOps.ops).toBeGreaterThan(2)
      expect(all.filter(line => line.type === 'op')).toHaveLength(withOps.ops)
      expect(all.find(line => line.type === 'op')?.op?.kind).toBe('create')
      expect(withOps.bytes).toBe(readFileSync(withOps.path).byteLength)

      const span = recorder.span('backlog export')
      expect(span.attributes).toMatchObject({ 'dshx.backlog.export.format': 'jsonl', 'dshx.backlog.export.items': 2 })
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.effect('copies the SQLite file, and refuses relative, existing or folderless targets', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const { store, exporter } = yield* open()
      yield* store.capture({ text: 'kept in the copy', actor: user })
      const directory = scratch()

      const copy = yield* exporter.run({ path: join(directory, 'backlog-copy.db'), format: 'sqlite' })
      expect(copy).toMatchObject({ format: 'sqlite', items: 1 })
      const database = new DatabaseSync(copy.path, { readOnly: true })
      expect(database.prepare('SELECT count(*) AS count FROM items WHERE deleted = 0').get()).toEqual({ count: 1 })
      expect(database.prepare("SELECT count(*) AS count FROM aliases WHERE kind = 'short'").get()).toEqual({ count: 1 })
      database.close()

      const existing = join(directory, 'taken.jsonl')
      writeFileSync(existing, 'mine')
      const refused = (path: string) =>
        Effect.flatMap(Effect.flip(exporter.run({ path, format: 'jsonl' })), error =>
          error._tag === 'BacklogExportRefused' ? Effect.succeed(error) : Effect.die(error),
        )
      expect((yield* refused('relative.jsonl')).reason).toBe('relative')
      expect((yield* refused(existing)).reason).toBe('exists')
      expect((yield* refused(copy.path)).reason).toBe('exists')
      expect((yield* refused(join(directory, 'missing', 'x.jsonl'))).reason).toBe('no-folder')
      expect(readFileSync(existing, 'utf8')).toBe('mine')
      expect((yield* refused(existing)).message).toMatch(/never overwrites a file\. Choose a new file name\./u)
    }).pipe(Effect.scoped),
  )
})
