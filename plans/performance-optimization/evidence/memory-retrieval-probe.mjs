import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryStore } from '../../../plugins/@dshfiles/memory/src/store.ts'

/**
 * Memory retrieval scope probe. Builds a scratch database in which one unrelated project's corpus outranks the
 * requested project's notes, then asks for the requested project only. Run from the repository root with
 * `node --experimental-strip-types plans/performance-optimization/evidence/memory-retrieval-probe.mjs`.
 */
const root = await mkdtemp(join(tmpdir(), 'h07-probe-'))
const path = join(root, 'memory.sqlite')
const store = openMemoryStore({ path, now: () => 1_760_000_000_000 })

const note = (project, text) => ({
  project,
  text,
  category: 'project',
  scope: 'repo',
  confidence: 'stated',
  sourceThread: 'session-a',
  sourceSeq: null,
  origin: 'agent',
})

const NOISE = 2_000
const started = Date.now()
// Short, term-dense noise outranks an in-scope note that mentions the term once inside a long body.
for (let index = 0; index < NOISE; index += 1) store.addNote(note('noise', `checkpoint checkpoint checkpoint noise ${String(index)}`))
for (let index = 0; index < 5; index += 1) {
  store.addNote(note('mine', `${'filler sentence about the project. '.repeat(20)}checkpoint ${String(index)} ${'more filler. '.repeat(20)}`))
}
const insertMs = Date.now() - started

const scopedStarted = Date.now()
const scoped = store.search({ query: 'checkpoint', projects: ['mine'], limit: 10 })
const scopedMs = Date.now() - scopedStarted
const unscoped = store.search({ query: 'checkpoint', projects: [], limit: 10 })
console.log(
  JSON.stringify(
    {
      noiseNotes: NOISE,
      inScopeNotes: 5,
      insertMs,
      scopedMs,
      scopedHits: scoped.length,
      scopedProjects: [...new Set(scoped.map(hit => hit.project))],
      unscopedTop10: unscoped.map(hit => hit.project),
    },
    null,
    2,
  ),
)

const database = new DatabaseSync(path, { readOnly: true })
for (const [label, sql, parameters] of [
  ['docs_words FTS', `select d.kind, d.ref, d.project from docs_words d where docs_words match ? order by bm25(docs_words) limit ?`, ['checkpoint', 200]],
  ['embeddings by model', `select e.kind, e.ref, e.project from embeddings e where e.model = ?`, ['model']],
]) {
  console.log(`EXPLAIN QUERY PLAN ${label}:`)
  for (const row of database.prepare(`explain query plan ${sql}`).all(...parameters)) console.log('  ', row['detail'])
}
database.close()
store.close()
await rm(root, { recursive: true, force: true })
