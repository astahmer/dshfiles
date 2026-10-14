// Retrieval experiment: BM25-only vs embeddings-only vs hybrid (reciprocal rank fusion) on recall@5 and latency.
// Usage: node bench/retrieval.ts [--models bge,gemma] [--items 5000] [--json out.json]
// Embeddings are optional: set MEMORY_EMBEDDINGS_MODULE to an installed `@huggingface/transformers` entry (not a
// dependency of this package). Without it only BM25 runs.
//
// Recall set:
//   exact      — synthetic identifiers (INC-10050, ...) asked for directly;
//   paraphrase — synthetic topics asked about without any of the digest's rare words;
//   natural    — the recall and cross-session probes of the support, infra-rollout and product-support scenarios,
//                answered from the user prompts of those scenarios (mixed into the synthetic corpus as distractors).
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { openMemoryStore, type SearchHit } from '../src/store.ts'
import { seedSyntheticCorpus } from '../src/testing/synthetic-corpus.ts'

const { values } = parseArgs({ options: { models: { type: 'string', default: '' }, items: { type: 'string', default: '5000' }, json: { type: 'string' } } })
const optmemBench = resolve(import.meta.dirname, '../../optmem/bench')
const { loadScenario } = await import(pathToFileURL(join(optmemBench, 'scenario-loader.mjs')).href)
const { generateFixture } = await import(pathToFileURL(join(optmemBench, 'fixtures.mjs')).href)
const { fillTruth } = await import(pathToFileURL(join(optmemBench, 'probes.mjs')).href)

const now = Date.UTC(2026, 9, 14)
const store = openMemoryStore({ path: ':memory:', now: () => now })
const { questions } = seedSyntheticCorpus({ store, items: Number(values.items), projects: 40, now })

type Question = {
  readonly set: 'exact' | 'paraphrase' | 'natural'
  readonly query: string
  readonly project: string
  readonly relevant: (hit: SearchHit) => boolean
}
const texts = new Map<string, { readonly text: string; readonly project: string }>()
const keyOf = (hit: SearchHit): string => (hit.kind === 'thread' ? `t:${hit.id}` : hit.kind === 'note' ? `n:${hit.id}` : `m:${hit.thread}:${hit.seq}`)
const textOf = (hit: SearchHit): string =>
  texts.get(keyOf(hit))?.text ?? (hit.kind === 'thread' ? (store.thread(hit.id)?.digest ?? '') : hit.kind === 'note' ? (store.note(hit.id)?.text ?? '') : '')

const recallSet: Question[] = questions.map(question => {
  if (question.expected.startsWith('topic:')) {
    const words = question.expected.slice('topic:'.length)
    return {
      set: 'paraphrase',
      query: question.query,
      project: question.project,
      relevant: hit => hit.project === question.project && textOf(hit).includes(words),
    }
  }
  return { set: 'exact', query: question.query, project: question.project, relevant: hit => keyOf(hit) === question.expected }
})

const natural: { readonly answers: (text: string) => boolean; readonly question: Question }[] = []
const scratch = await mkdtemp(join(tmpdir(), 'memory-retrieval-'))
for (const name of ['support.json', 'infra-rollout.mjs', 'product-support.mjs']) {
  const { scenario } = await loadScenario({ path: join(optmemBench, 'scenarios', name), rep: 1, variant: 'long' })
  const truth = { ...(await generateFixture(scenario.fixture, join(scratch, scenario.name))), ...scenario.truth }
  const project = `/bench/${scenario.name}`
  let index = 0
  for (const conversation of scenario.conversations)
    for (const turn of conversation.turns) {
      index++
      const prompt = fillTruth(turn.prompt, truth)
      if (turn.probe !== undefined) {
        const expected: string[][] = turn.probe.expect.map((item: string | string[]) => [item].flat().map(option => fillTruth(option, truth).toLowerCase()))
        const answers = (text: string): boolean => expected.every(options => options.some(option => text.toLowerCase().includes(option)))
        natural.push({
          answers,
          question: {
            set: 'natural',
            query: prompt
              .replace(/Do not open files.*$/s, '')
              .replace(/^New thread\.?\s*/i, '')
              .trim(),
            project,
            relevant: hit => hit.project === project && answers(textOf(hit)),
          },
        })
        continue
      }
      const id = `session-${scenario.name}-${String(index).padStart(3, '0')}`
      store.putThread({
        id,
        project,
        parent: null,
        title: prompt.slice(0, 60),
        decision: prompt.slice(0, 120),
        digest: prompt.slice(0, 6_000),
        source: 'trail',
        lastSeq: index,
        updatedAt: now - 86_400_000,
      })
      texts.set(`t:${id}`, { text: prompt, project })
    }
}
await rm(scratch, { recursive: true, force: true })
// A natural probe only counts when some stored prompt of its scenario carries the answer (others are answered by tool output).
for (const entry of natural)
  if ([...texts.values()].some(document => document.project === entry.question.project && entry.answers(document.text))) recallSet.push(entry.question)

type Embedder = {
  readonly name: string
  readonly dims: number
  readonly embed: (texts: readonly string[], kind: 'query' | 'document') => Promise<readonly Float32Array[]>
}

const embedders: Embedder[] = []
const modulePath = process.env['MEMORY_EMBEDDINGS_MODULE']
if (modulePath !== undefined && values.models.length > 0) {
  const transformers = await import(pathToFileURL(modulePath).href)
  transformers.env.cacheDir = process.env['MEMORY_EMBEDDINGS_CACHE'] ?? transformers.env.cacheDir
  const pick = (name: string) =>
    name === 'gemma'
      ? {
          name: 'embeddinggemma-300m-q8@256',
          repo: 'onnx-community/embeddinggemma-300m-ONNX',
          dims: 256,
          query: 'task: search result | query: ',
          document: 'title: none | text: ',
        }
      : {
          name: 'bge-small-en-v1.5-q8',
          repo: 'Xenova/bge-small-en-v1.5',
          dims: 384,
          query: 'Represent this sentence for searching relevant passages: ',
          document: '',
        }
  for (const name of values.models.split(',')) {
    const spec = pick(name)
    const extractor = await transformers.pipeline('feature-extraction', spec.repo, { dtype: 'q8' })
    embedders.push({
      name: spec.name,
      dims: spec.dims,
      embed: async (inputs, kind) => {
        const output = await extractor(
          inputs.map(text => `${kind === 'query' ? spec.query : spec.document}${text.slice(0, 2_000)}`),
          { pooling: name === 'gemma' ? 'mean' : 'cls', normalize: true },
        )
        const full = Number(output.dims.at(-1))
        const data = Float32Array.from(output.data)
        return inputs.map((_, row) => {
          const vector = data.slice(row * full, row * full + spec.dims)
          const norm = Math.hypot(...vector) || 1
          return vector.map(value => value / norm)
        })
      },
    })
  }
}

const percentile = (values: readonly number[], fraction: number): number =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0

const evaluate = async (ranker: 'bm25' | 'vector' | 'hybrid', embedder: Embedder | undefined) => {
  const bySet = new Map<string, { hits: number; total: number }>()
  const searchMs: number[] = []
  const embedMs: number[] = []
  for (const question of recallSet) {
    let queryVector: Float32Array | undefined
    if (embedder !== undefined) {
      const started = performance.now()
      queryVector = (await embedder.embed([question.query], 'query'))[0]
      embedMs.push(performance.now() - started)
    }
    const started = performance.now()
    const hits = store.search({
      query: question.query,
      projects: [],
      ownProject: question.project,
      limit: 5,
      ranker,
      queryVector,
      embeddingModel: embedder?.name,
    })
    searchMs.push(performance.now() - started)
    const entry = bySet.get(question.set) ?? { hits: 0, total: 0 }
    entry.total++
    if (hits.some(question.relevant)) entry.hits++
    bySet.set(question.set, entry)
  }
  return {
    ranker,
    model: embedder?.name ?? '—',
    recallAt5: Object.fromEntries([...bySet].map(([set, entry]) => [set, `${entry.hits}/${entry.total}`])),
    searchMsP50: Number(percentile(searchMs, 0.5).toFixed(2)),
    searchMsP95: Number(percentile(searchMs, 0.95).toFixed(2)),
    queryEmbedMsP50: embedMs.length === 0 ? 0 : Number(percentile(embedMs, 0.5).toFixed(1)),
  }
}

const results = [await evaluate('bm25', undefined)]
for (const embedder of embedders) {
  const started = performance.now()
  const documents = [
    ...store
      .listThreads({ limit: 100_000 })
      .map(thread => ({ kind: 'thread' as const, ref: thread.id, project: thread.project, text: `${thread.title}\n${thread.digest}` })),
    ...store.listNotes({ limit: 100_000 }).map(note => ({ kind: 'note' as const, ref: String(note.id), project: note.project, text: note.text })),
  ]
  for (let index = 0; index < documents.length; index += 32) {
    const batch = documents.slice(index, index + 32)
    const vectors = await embedder.embed(
      batch.map(document => document.text),
      'document',
    )
    batch.forEach((document, row) =>
      store.putEmbedding({
        kind: document.kind,
        ref: document.ref,
        project: document.project,
        model: embedder.name,
        vector: vectors[row] ?? new Float32Array(),
      }),
    )
  }
  const indexSeconds = (performance.now() - started) / 1_000
  for (const ranker of ['vector', 'hybrid'] as const)
    results.push({ ...(await evaluate(ranker, embedder)), indexSeconds: Number(indexSeconds.toFixed(1)), documents: documents.length } as never)
}

const counts = Object.fromEntries(['exact', 'paraphrase', 'natural'].map(set => [set, recallSet.filter(question => question.set === set).length]))
console.log(JSON.stringify({ items: Number(values.items), questions: counts, results }, null, 2))
if (values.json !== undefined) await writeFile(values.json, `${JSON.stringify({ items: Number(values.items), questions: counts, results }, null, 2)}\n`)
