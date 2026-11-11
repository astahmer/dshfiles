/**
 * Measure what a content search feels while the worker commits one bounded ingest group — the window the README used to
 * bound by the group size alone. A 64-Session corpus of ~5 MiB of document text fills one `GROUP_SESSIONS` group, then
 * every log gains two events so a second group of the same size commits. Searches are issued one at a time back to back
 * through the real built worker, so each round trip includes any queueing behind the ingest transaction.
 *
 * Gated on `WORKER_COMMIT_BENCH=1`; run it with `pnpm bench:commit`. Writes its JSON to `WORKER_COMMIT_BENCH_OUT`.
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { appendSessionLogEvent } from './session-log-fixture.js'
import { openSearchWorker } from '../src/worker-port-promise.js'

const SESSIONS = Number(process.env.WORKER_COMMIT_BENCH_SESSIONS ?? '64')
const MESSAGE_BYTES = Number(process.env.WORKER_COMMIT_BENCH_MESSAGE_BYTES ?? '62000')
const REPLY_BYTES = Number(process.env.WORKER_COMMIT_BENCH_REPLY_BYTES ?? '18000')
const SEARCH_BUDGET_MS = Number(process.env.WORKER_COMMIT_BENCH_BUDGET_MS ?? '1500')
const runDir = join(tmpdir(), `session-search-commit-bench-${String(process.pid)}`)

const vocab = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']
/** Deterministic text with readable words, the corpus marker, and enough bytes to fill one document. */
const textOf = (bytes: number, marker: string, session: number): string => {
  const parts: string[] = []
  let length = 0
  for (let index = 0; length < bytes; index += 1) {
    const word = index % 97 === 0 ? marker : (vocab[(index + session) % vocab.length] ?? 'alpha')
    const chunk = index % 97 === 0 ? `${word} ` : `${word}${String(index)} `
    parts.push(chunk)
    length += chunk.length
  }
  return parts.join('').slice(0, bytes)
}

const writeBenchLog = async (input: { readonly directory: string; readonly sessionId: string; readonly session: number }): Promise<string> => {
  await mkdir(input.directory, { recursive: true })
  const compress = (text: string): Buffer => zstdCompressSync(Buffer.from(text, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  const time = 1_700_000_000_000 + input.session * 1_000
  const header = `${JSON.stringify({ type: 'session', version: 4, id: input.sessionId, createdAt: time, cwd: '/dev/dshfiles', isSeeded: false })}\n`
  const question = `${JSON.stringify({
    type: 'user/message',
    seq: 0,
    time: time + 1,
    data: { id: 'msg-0', role: 'user', content: [{ type: 'text', text: textOf(MESSAGE_BYTES, 'needle', input.session) }], source: { kind: 'user' } },
    surfaceOp: 'append',
  })}\n`
  const answer = `${JSON.stringify({
    type: 'assistant/message',
    seq: 1,
    time: time + 2,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'answer-1',
        role: 'assistant',
        content: [{ type: 'text', text: textOf(REPLY_BYTES, 'straw', input.session) }],
        source: { provider: 'bench', model: 'bench' },
      },
      stream: [],
    },
    surfaceOp: 'append',
  })}\n`
  const path = join(input.directory, 'session.v4.jsonl.zstd')
  await writeFile(path, Buffer.concat([compress(header), compress(question), compress(answer)]))
  return path
}

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return Number((sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0).toFixed(1))
}

const summarize = (values: readonly number[]) => ({
  samples: values.length,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  maxMs: values.length === 0 ? 0 : Number(Math.max(...values).toFixed(1)),
})

describe.runIf(process.env.WORKER_COMMIT_BENCH === '1')('ingest group commit latency', { timeout: 300_000 }, () => {
  afterAll(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  it('answers searches while one 64-Session ~5 MiB group commits', async () => {
    const root = join(runDir, 'sessions')
    const project = 'bench'
    const client = openSearchWorker({ indexPath: join(runDir, 'index.sqlite') })
    const logs: string[] = []
    let documentBytes = 0
    for (let session = 0; session < SESSIONS; session += 1) {
      const sessionId = `session-${String(session).padStart(8, '0')}-0000-4000-8000-000000000000`
      logs.push(await writeBenchLog({ directory: join(root, project, sessionId), sessionId, session }))
      documentBytes += MESSAGE_BYTES + REPLY_BYTES
    }

    const searchLatencies: number[] = []
    const search = async (): Promise<number> => {
      const startedAt = performance.now()
      await client.port.searchSessions({ query: 'needle', limit: 5 })
      return performance.now() - startedAt
    }

    const firstStartedAt = Date.now()
    const firstCpu = process.cpuUsage()
    await client.startIngest(root)
    // The first build runs without search probes, so its wall and CPU measure the write path itself.
    const building = await (async () => {
      const deadline = Date.now() + 120_000
      for (;;) {
        const health = await client.health()
        if (health.behindSessions === 0 && !health.ingesting && health.sessions === SESSIONS) return true
        if (Date.now() > deadline) return false
      }
    })()
    const initialMs = Date.now() - firstStartedAt
    const initialCpu = process.cpuUsage(firstCpu)
    expect(building).toBe(true)

    // A second, incremental group of the same size: every log gains two events appended as new frames.
    const baselineDocuments = (await client.health()).documents
    const deltaQuestion = textOf(MESSAGE_BYTES, 'rearm', 7)
    const deltaAnswer = textOf(REPLY_BYTES, 'straw', 3)
    for (const log of logs) {
      await appendSessionLogEvent(log, {
        type: 'user/message',
        seq: 2,
        time: 1_700_000_100_000,
        data: { id: 'msg-delta', role: 'user', content: [{ type: 'text', text: deltaQuestion }], source: { kind: 'user' } },
      })
      await appendSessionLogEvent(log, {
        type: 'assistant/message',
        seq: 3,
        time: 1_700_000_100_001,
        data: {
          turn: 2,
          step: 1,
          message: { id: 'answer-2', role: 'assistant', content: [{ type: 'text', text: deltaAnswer }], source: { provider: 'bench', model: 'bench' } },
          stream: [],
        },
      })
    }
    searchLatencies.length = 0
    let answeredWhileIngesting = 0
    const deltaStartedAt = Date.now()
    const deltaCpu = process.cpuUsage()
    await client.nudge()
    const deltaIngest = await (async () => {
      const deadline = Date.now() + 120_000
      for (let round = 0; ; round += 1) {
        // The delta pass inserts ~2x the documents of the first build, so wait for its commit to land in the counts.
        if (round % 4 === 0) {
          const health = await client.health()
          if (health.behindSessions === 0 && !health.ingesting && health.documents > baselineDocuments) return Date.now() - deltaStartedAt
        }
        if (Date.now() > deadline) return -1
        searchLatencies.push(await search())
        // A search that returns while the worker still reports a running pass was answered mid-pass, not between passes.
        if ((await client.health()).ingesting) answeredWhileIngesting += 1
      }
    })()
    expect(deltaIngest).toBeGreaterThanOrEqual(0)
    const health = await client.health()
    const deltaCpuUsed = process.cpuUsage(deltaCpu)
    const commitMaxSamples = Math.max(...searchLatencies)
    // Idle references the same query on the same built index, so the commit slowdown is comparable across runs on a
    // machine whose load moves under the measurement.
    const idleLatencies: number[] = []
    for (let round = 0; round < 30; round += 1) idleLatencies.push(await search())
    const idle = summarize(idleLatencies)
    // The delta is searchable once the group committed: every Session now carries the second marker.
    const afterDelta = await client.port.searchSessions({ query: 'rearm', limit: 100 })
    const deltaSessions = afterDelta.matches.length
    const searchableNeedle = await client.port.searchSessions({ query: 'needle', limit: 100 })
    const digest = searchableNeedle.matches.map(match => `${match.sessionId}:${match.seq}`).join('|')

    const report = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      loadAverage: loadavg(),
      corpus: {
        sessions: SESSIONS,
        documentMiB: Number((documentBytes / 1048576).toFixed(2)),
        logBytes: (await Promise.all(logs.map(async log => (await stat(log)).size))).reduce((sum, size) => sum + size, 0),
      },
      initialBuild: { wallMs: initialMs, cpuMs: Math.round((initialCpu.user + initialCpu.system) / 1000) },
      deltaGroup: { wallMs: deltaIngest, cpuMs: Math.round((deltaCpuUsed.user + deltaCpuUsed.system) / 1000), health },
      searchWhileIngesting: { ...summarize(searchLatencies), answeredWhileIngesting, budgetMs: SEARCH_BUDGET_MS },
      searchIdle: idle,
      commitSlowdown: Number((commitMaxSamples / Math.max(1, idle.maxMs)).toFixed(2)),
      correctness: { deltaSessionsOf: SESSIONS, deltaSessions, needleMatches: searchableNeedle.matches.length, hasMore: searchableNeedle.hasMore, digest },
    }
    const text = `${JSON.stringify(report, null, 2)}\n`
    if (process.env.WORKER_COMMIT_BENCH_OUT !== undefined) await writeFile(process.env.WORKER_COMMIT_BENCH_OUT, text)
    console.log(text)
    await client.close()

    // The documented warm-index budget covers a search that lands inside an ingest pass; the tail is reported per run.
    expect(report.searchWhileIngesting.p95Ms).toBeLessThanOrEqual(SEARCH_BUDGET_MS)
    expect(deltaSessions).toBe(SESSIONS)
  })
})
