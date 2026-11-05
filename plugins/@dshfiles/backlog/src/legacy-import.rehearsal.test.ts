import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogItems, type BacklogItem } from './item.js'
import { BacklogOps } from './op-log.js'
import { BacklogStore } from './store.js'
import { LegacySyncMappings } from './sync-legacy-mapping.js'
import { backlogStoreLayer } from './test-support.js'

/**
 * Rehearses the one-time import against a copy of a live store: set BACKLOG_REHEARSAL_DIR to a folder holding copies
 * of `backlog.json` and `backlog_files.json` (and `backlog_sync.json`/`backlog_meta.json` when present). The SQLite
 * file lands in `<dir>/sqlite/`; the report in `<dir>/report.json`. Skipped without the variable.
 */
const directory = process.env['BACKLOG_REHEARSAL_DIR']

const fileSchema = Schema.Struct({ itemId: Schema.Number, attachment: BacklogItems.attachmentSchema, data: Schema.String })

/** A storage-domain JSON file holds `{ tables: { <table>: { <key>: <row> } } }`. */
const domainFile = <Table extends Schema.Top>(table: Table) => Schema.fromJsonString(Schema.Struct({ tables: table }))
const itemsFile = domainFile(Schema.Struct({ items: Schema.Record(Schema.String, BacklogItems.itemSchema) }))
const filesFile = domainFile(Schema.Struct({ files: Schema.Record(Schema.String, fileSchema) }))
const mappingsFile = domainFile(Schema.Struct({ mappings: Schema.Record(Schema.String, LegacySyncMappings.schema) }))
const countersFile = domainFile(Schema.Struct({ counters: Schema.Record(Schema.String, Schema.Struct({ nextId: Schema.Number })) }))

/** The copy's text of one domain file, or `null` when the live store never wrote it. */
const textOf = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

const itemFields = [
  'id',
  'title',
  'body',
  'kind',
  'status',
  'project',
  'tags',
  'links',
  'tweetContextUrls',
  'attachments',
  'actors',
  'pinned',
  'humanFields',
  'createdAt',
  'lastActivityAt',
  'events',
  'proposal',
  'attention',
  'acknowledgedAt',
  'snoozedUntil',
] as const satisfies readonly (keyof BacklogItem)[]
const sha256 = (base64: string) => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')

const stored = (item: BacklogItem & { readonly freshness?: unknown }): BacklogItem => {
  const { freshness: _freshness, ...rest } = item
  return {
    ...rest,
    events: rest.events.map(event => {
      if (event.commentId?.startsWith('legacy-') !== true) return event
      const { commentId: _commentId, ...kept } = event
      return kept
    }),
  }
}

const p50 = (samples: readonly number[]) => [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)] ?? 0

describe.skipIf(directory === undefined)('legacy import rehearsal', () => {
  it.effect(
    'imports a copy of the live store and folds every item back to what the JSON store served',
    () =>
      Effect.gen(function* () {
        const root = directory ?? ''
        const storages = join(root, 'storages')
        const itemsText = textOf(join(storages, 'backlog.json'))
        const filesText = textOf(join(storages, 'backlog_files.json'))
        const mappingsText = textOf(join(storages, 'backlog_sync.json'))
        const countersText = textOf(join(storages, 'backlog_meta.json'))
        const items = itemsText === null ? [] : Object.values(Schema.decodeUnknownSync(itemsFile)(itemsText).tables.items)
        const files = filesText === null ? [] : Object.values(Schema.decodeUnknownSync(filesFile)(filesText).tables.files)
        const mappings = mappingsText === null ? [] : Object.entries(Schema.decodeUnknownSync(mappingsFile)(mappingsText).tables.mappings)
        const counter = Option.fromUndefinedOr(
          countersText === null ? undefined : Schema.decodeUnknownSync(countersFile)(countersText).tables.counters['items'],
        )
        const sqliteDirectory = join(root, 'sqlite', String(Date.now()))
        mkdirSync(sqliteDirectory, { recursive: true })
        const rows = {
          database: join(sqliteDirectory, 'backlog.db'),
          files: join(sqliteDirectory, 'files'),
          legacy: { items, files, mappings, nextId: Option.match(counter, { onNone: () => null, onSome: value => value.nextId }) },
        }
        const openBacklog = Effect.map(Layer.build(backlogStoreLayer({ rows })), context => ({
          store: Context.get(context, BacklogStore),
          repo: Context.get(context, BacklogRepo),
        }))

        const importStarted = performance.now()
        const imported = yield* openBacklog
        const importMs = performance.now() - importStarted
        const loadStarted = performance.now()
        const { store, repo } = yield* openBacklog
        const loadMs = performance.now() - loadStarted

        const served = new Map((yield* store.getMany(items.map(item => item.id))).items.map(detail => [detail.item.id, stored(detail.item)]))
        const folded = new Map((yield* repo.foldAll).map(item => [item.id, item]))
        const mismatches: { readonly id: number; readonly fields: readonly string[] }[] = []
        const counts = { items: items.length, equal: 0, foldEqual: 0, comments: 0, events: 0, links: 0, tags: 0, actors: 0 }
        for (const legacy of items) {
          const expected = { ...legacy, project: BacklogItems.projectOf(legacy.project) }
          const actual = served.get(legacy.id)
          counts.comments += legacy.events.filter(event => event.kind === 'commented').length
          counts.events += legacy.events.length
          counts.links += legacy.links.length
          counts.tags += legacy.tags.length
          counts.actors += legacy.actors.length
          if (BacklogOps.sameValue(folded.get(legacy.id), actual)) counts.foldEqual += 1
          if (actual !== undefined && BacklogOps.sameValue(expected, actual)) {
            counts.equal += 1
            continue
          }
          const fields = itemFields.filter(field => actual === undefined || !BacklogOps.sameValue(expected[field], actual[field]))
          mismatches.push({ id: legacy.id, fields })
        }

        const liveIds = new Set(items.map(item => item.id))
        let attachmentsMatched = 0
        let attachmentsMissing = 0
        for (const file of files.filter(candidate => liveIds.has(candidate.itemId))) {
          const read = yield* store.readFile({ id: file.itemId, attachmentId: file.attachment.id })
          const data = read.ok ? read.value.dataUrl.slice(read.value.dataUrl.indexOf(',') + 1) : null
          if (data !== null && sha256(data) === sha256(file.data)) attachmentsMatched += 1
          else attachmentsMissing += 1
        }
        let mappingsMatched = 0
        for (const [key, value] of mappings) if (BacklogOps.sameValue(Option.getOrUndefined(yield* repo.mappings.get(key)), value)) mappingsMatched += 1

        // Every legacy `b:<n>` still names its item, in every written form, and stays a number (no short alias).
        let aliasesResolved = 0
        for (const legacy of items) {
          const forms = [String(legacy.id), `b:${String(legacy.id)}`, legacy.id]
          const resolved = yield* Effect.forEach(forms, form => store.resolve(form))
          if (resolved.every(id => id === legacy.id) && served.get(legacy.id)?.ref === undefined) aliasesResolved += 1
        }
        const itemLinks = items.flatMap(item => item.links.filter(link => link.type === 'item').map(link => ({ from: item.id, target: link.target })))
        let itemLinksResolved = 0
        for (const link of itemLinks) if ((yield* store.resolve(link.target)) !== undefined) itemLinksResolved += 1
        const fresh = yield* store.capture({ text: 'rehearsal: a new item gets a short alias', actor: { kind: 'user' } })
        const freshRef = fresh.item.ref ?? ''

        const listTimes: number[] = []
        const searchTimes: number[] = []
        const operatorTimes: number[] = []
        for (let run = 0; run < 25; run++) {
          const listStarted = performance.now()
          yield* store.list({ freshness: 'all', limit: 100 })
          listTimes.push(performance.now() - listStarted)
          const searchStarted = performance.now()
          yield* store.list({ query: 'composer thread', freshness: 'all' })
          searchTimes.push(performance.now() - searchStarted)
          const tagStarted = performance.now()
          yield* store.list({ query: 'status:done kind:bug', freshness: 'all' })
          operatorTimes.push(performance.now() - tagStarted)
        }

        const report = {
          counts,
          mismatches,
          attachments: { files: files.length, live: attachmentsMatched + attachmentsMissing, matched: attachmentsMatched, missing: attachmentsMissing },
          mappings: { legacy: mappings.length, matched: mappingsMatched },
          aliases: { legacy: items.length, resolved: aliasesResolved, itemLinks: itemLinks.length, itemLinksResolved, newItemRef: freshRef },
          importReport: Option.getOrUndefined(yield* imported.repo.importReport),
          tables: yield* repo.counts,
          nextCapture: yield* repo.nextId,
          ms: {
            import: Math.round(importMs),
            reopen: Math.round(loadMs),
            listP50: p50(listTimes),
            searchP50: p50(searchTimes),
            operatorP50: p50(operatorTimes),
          },
          sqliteDirectory,
        }
        writeFileSync(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
        expect(mismatches).toEqual([])
        expect(counts.foldEqual).toBe(items.length)
        expect(attachmentsMissing).toBe(0)
        expect(mappingsMatched).toBe(mappings.length)
        expect(aliasesResolved).toBe(items.length)
        expect(freshRef).toMatch(/^[0-9a-hjkmnp-tv-z]{4}$/u)
        expect(yield* store.resolve(freshRef)).toBe(fresh.item.id)
        expect(yield* store.resolve(String(fresh.item.id))).toBeUndefined()
      }).pipe(Effect.scoped),
    600_000,
  )
})
