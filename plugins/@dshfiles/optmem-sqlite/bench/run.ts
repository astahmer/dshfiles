import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { createMemoryEngine, StreamIds, TreeMath, type MemoryAccess, type NormalizedEvent } from '@dshfiles/optmem-core'

import { openSqliteMemory } from '../src/sqlite-memory.ts'
import { createFakeSummarizer } from '../src/testing/fake-summarizer.ts'

const sizes = process.argv.slice(2).map(Number).filter(Number.isFinite)
const projects = ['atlas', 'borealis', 'cobalt', 'delta']
const conversationsPerProject = 5
const words = [
  'invoice',
  'deploy',
  'migration',
  'cache',
  'refactor',
  'parser',
  'schema',
  'retry',
  'webhook',
  'tenant',
  'billing',
  'session',
  'token',
  'index',
  'queue',
]

const random = (() => {
  let seed = 0x5eed
  return (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
})()

const pick = <Item>(items: readonly Item[]): Item => {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('pick from empty list')
  return item
}

const sentence = (length: number): string => Array.from({ length }, () => pick(words)).join(' ')

const syntheticEvent = (index: number): NormalizedEvent => {
  const project = pick(projects)
  const conversationId = `${project}-${Math.floor(random() * conversationsPerProject)}`
  const large = random() < 0.05
  const role = large ? 'tool_result' : index % 2 === 0 ? 'user' : 'assistant'
  const text = large ? `${sentence(300)} unique-${index}` : `${sentence(8 + Math.floor(random() * 40))} unique-${index}`
  return {
    eventKey: `bench:${index}`,
    harness: 'bench',
    conversationId,
    projectId: project,
    parentConversationId: null,
    role,
    createdAt: 1_700_000_000_000 + index,
    text,
    bytes: Buffer.byteLength(text),
    truncated: false,
    meta: {},
    streams: [StreamIds.conversation(conversationId), StreamIds.project(project)],
  }
}

const percentile = (samples: readonly number[], ratio: number): number => {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}

const timeEach = async (count: number, run: (index: number) => Promise<unknown>): Promise<{ p50: number; p95: number }> => {
  const samples: number[] = []
  for (let index = 0; index < count; index++) {
    const started = performance.now()
    await run(index)
    samples.push(performance.now() - started)
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) }
}

const ms = (value: number): string => `${value.toFixed(2)} ms`
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const runBenchmark = async (size: number): Promise<Record<string, string>> => {
  const directory = mkdtempSync(join(tmpdir(), 'optmem-bench-'))
  const path = join(directory, 'bench.db')
  try {
    const memory = openSqliteMemory({ path })
    const appendStarted = performance.now()
    for (let index = 0; index < size; index++) await memory.store.appendEvents([syntheticEvent(index)])
    const appendSeconds = (performance.now() - appendStarted) / 1000

    const summarizer = createFakeSummarizer()
    const engine = createMemoryEngine({ store: memory.store, search: memory.search, summarizer })
    const buildStarted = performance.now()
    await engine.start()
    await engine.drain()
    const buildSeconds = (performance.now() - buildStarted) / 1000
    const built = await engine.status()

    const steadyCount = 1_000
    const steady = await timeEach(steadyCount, async index => {
      const event = syntheticEvent(size + index)
      await engine.append([event])
      await engine.drain()
    })

    const stream = StreamIds.project('atlas')
    const access: MemoryAccess = { conversationId: 'atlas-0', projectId: 'atlas', allowAllProjects: false }
    const snapshot = await engine.snapshot({ stream })
    const view = (await memory.store.getView(stream)) ?? { nodes: [] }
    const internal = view.nodes.filter(node => node.level > 0)
    const searchLatency = await timeEach(50, index =>
      engine.search({ query: index % 2 === 0 ? pick(words) : `unique-${Math.floor(random() * size)}`, scope: 'project', access }),
    )
    const zoomLatency = await timeEach(50, index => {
      const node = internal[index % Math.max(1, internal.length)] ?? view.nodes[0]
      return engine.zoom({ stream, address: node ? TreeMath.format(node) : '0+1', access })
    })
    const contextLatency = await timeEach(50, () => engine.context({ stream, pos: Math.floor(random() * snapshot.length), access }))
    const snapshotLatency = await timeEach(20, () => engine.snapshot({ stream }))
    const status = await engine.status()
    await engine.close()
    memory.close()
    const projectStreams = status.streams.filter(entry => entry.stream.startsWith('project:'))
    return {
      events: size.toLocaleString('en-US'),
      'append (store, 1 event/tx)': `${Math.round(size / appendSeconds).toLocaleString('en-US')} ev/s`,
      'build tree+views from scratch': `${buildSeconds.toFixed(1)} s`,
      'summarizer calls / clips': `${built.summarizer.calls.toLocaleString('en-US')} / ${built.summarizer.clips}`,
      'merge-batch line merges': built.merges.toLocaleString('en-US'),
      'steady append+drain p50 / p95': `${ms(steady.p50)} / ${ms(steady.p95)}`,
      'search p50 / p95': `${ms(searchLatency.p50)} / ${ms(searchLatency.p95)}`,
      'zoom p50 / p95': `${ms(zoomLatency.p50)} / ${ms(zoomLatency.p95)}`,
      'context p50 / p95': `${ms(contextLatency.p50)} / ${ms(contextLatency.p95)}`,
      'snapshot p50 / p95': `${ms(snapshotLatency.p50)} / ${ms(snapshotLatency.p95)}`,
      'project view bytes (max) / lines': `${Math.max(...projectStreams.map(entry => entry.viewBytes)).toLocaleString('en-US')} / ${Math.max(...projectStreams.map(entry => entry.viewLines))}`,
      'database file': mb(statSync(path).size),
      'process RSS': mb(process.memoryUsage().rss),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const results: Record<string, string>[] = []
for (const size of sizes.length > 0 ? sizes : [10_000, 100_000]) results.push(await runBenchmark(size))
const metrics = Object.keys(results[0] ?? {})
console.log(`| metric | ${results.map(result => result['events']).join(' | ')} |`)
console.log(`|---|${results.map(() => '---').join('|')}|`)
for (const metric of metrics.filter(name => name !== 'events')) console.log(`| ${metric} | ${results.map(result => result[metric]).join(' | ')} |`)
console.log(`\nnode ${process.version}, ${process.platform}/${process.arch}`)
