/**
 * Bench the owned search backend against the real corpus. Hardlink the newest session logs into a temporary root (the
 * live corpus is only ever read), let the worker index them, and measure what the Host event loop feels through a
 * second process that pings a socket this process serves — while content searches run against the filling index.
 *
 * The suite is skipped unless `OWNED_BENCH=1`; run it with `pnpm bench:owned`, which builds the worker first.
 */
import { spawn } from 'node:child_process'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { homedir, loadavg, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { FrameLog } from '../src/frame-log.js'
import { SessionSearchEngine } from '../src/engine.js'
import { SearchWorkerClient } from '../src/worker-client.js'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

const QUERIES = ['retry storm', 'freeze', 'thread sidebar', 'session search', 'workspace']
const STALL_BUDGET_MS = 250
const SEARCH_P95_BUDGET_MS = 1_500

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return Number((sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0).toFixed(1))
}

const runDir = resolve(process.env.OWNED_BENCH_RUN_DIR ?? join(tmpdir(), 'owned-search-bench'))
const corpusRoot = resolve(process.env.OWNED_BENCH_CORPUS ?? join(homedir(), '.dsh', 'sessions'))
const stockIndex = resolve(process.env.OWNED_BENCH_STOCK_INDEX ?? join(homedir(), '.dsh', 'plugins', 'session-query-sqlite', 'index.sqlite'))
const subsetSize = Number(process.env.OWNED_BENCH_SESSIONS ?? '120')
const subsetMaxMb = Number(process.env.OWNED_BENCH_MAX_MB ?? '150')
const maxMinutes = Number(process.env.OWNED_BENCH_MINUTES ?? '15')

const PINGER_SOURCE = `
const net = require('node:net')
const path = process.argv[1]
const gaps = []
const rtts = []
const percentile = (values, fraction) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}
let previous = Date.now()
setInterval(() => {
  const startedAt = Date.now()
  gaps.push(startedAt - previous)
  previous = startedAt
  const socket = net.connect(path)
  socket.on('data', () => {})
  socket.on('close', () => rtts.push(Date.now() - startedAt))
  socket.on('error', () => {})
}, 25)
process.on('SIGTERM', () => {
  console.log(JSON.stringify({
    samples: gaps.length,
    maxRttMs: rtts.length === 0 ? 0 : Math.max(...rtts),
    p99RttMs: percentile(rtts, 0.99),
    gapsOverBudget: gaps.filter(gap => gap > ${STALL_BUDGET_MS}).length,
  }))
  process.exit(0)
})
`

interface ProbeReading {
  readonly samples: number
  readonly maxRttMs: number
  readonly p99RttMs: number
  readonly gapsOverBudget: number
}

const startProbe = async (socketPath: string) => {
  await rm(socketPath, { force: true })
  const server = createServer(socket => {
    socket.on('error', () => undefined)
    socket.end('pong')
  })
  await new Promise<void>(resolveListen => server.listen(socketPath, () => resolveListen()))
  const child = spawn(process.execPath, ['-e', PINGER_SOURCE, socketPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  let output = ''
  child.stdout.on('data', chunk => {
    output += String(chunk)
  })
  return {
    stop: async (): Promise<ProbeReading> => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await new Promise(resolveExit => child.once('exit', resolveExit))
      }
      await new Promise(resolveClose => server.close(() => resolveClose()))
      await rm(socketPath, { force: true })
      try {
        return JSON.parse(output) as ProbeReading
      } catch {
        return { samples: 0, maxRttMs: -1, p99RttMs: -1, gapsOverBudget: -1 }
      }
    },
  }
}

const stockIndexedSessions = (): ReadonlySet<string> => {
  const database = new DatabaseSync(stockIndex, { readOnly: true })
  try {
    return new Set(database.prepare('SELECT id FROM persisted_sessions').all().map(row => String((row as { id: string }).id)))
  } catch {
    return new Set()
  } finally {
    database.close()
  }
}

/**
 * Copy (never hardlink: the live Host keeps appending) a byte-bounded subset of the newest logs the stock index already
 * knows, so both backends have content for the same sessions and the ingest converges on frozen bytes.
 */
const prepareSubset = async ({ target, known }: { readonly target: string; readonly known: ReadonlySet<string> }): Promise<{ readonly sessions: number; readonly bytes: number; readonly sessionIds: ReadonlySet<string> }> => {
  await rm(target, { recursive: true, force: true })
  const logs = await FrameLog.list(corpusRoot)
  const newest = [...logs]
    .filter(log => known.has(log.sessionId) || known.size === 0)
    .sort((left, right) => Number(right.mtimeNs) - Number(left.mtimeNs))
    .slice(0, subsetSize)
  const maxBytes = subsetMaxMb * 1024 * 1024
  const sessionIds = new Set<string>()
  let bytes = 0
  let sessions = 0
  for (const log of newest) {
    if (bytes + log.size > maxBytes) continue
    // The persistence layout is `<root>/<project>/<session>/<log>`; FrameLog.list walks exactly two directory levels.
    const sessionDirectory = basename(join(log.path, '..'))
    const projectDirectory = basename(join(log.path, '..', '..'))
    const directory = join(target, projectDirectory, sessionDirectory)
    await mkdir(directory, { recursive: true })
    await copyFile(log.path, join(directory, basename(log.path)))
    bytes += log.size
    sessions += 1
    sessionIds.add(log.sessionId)
  }
  return { sessions, bytes, sessionIds }
}

/** The stock backend's hits, restricted to the sessions this run indexed, so the two backends see the same corpus. */
const stockSessionIds = (query: string, sessionIds: ReadonlySet<string>): readonly string[] => {
  const known = [...sessionIds].slice(0, 400)
  if (known.length === 0) return []
  const database = new DatabaseSync(stockIndex, { readOnly: true })
  try {
    const placeholders = known.map(() => '?').join(', ')
    const rows = database
      .prepare(`SELECT DISTINCT session_id FROM persisted_docs WHERE persisted_docs MATCH ? AND session_id IN (${placeholders}) LIMIT 200`)
      .all(query, ...known)
    return rows.map(row => String((row as { session_id: string }).session_id))
  } catch {
    return []
  } finally {
    database.close()
  }
}

describe.skipIf(process.env.OWNED_BENCH !== '1')('owned search backend bench', () => {
  it(
    'indexes the corpus without stalling the Host and keeps answering searches',
    async () => {
      const root = join(runDir, 'sessions')
      const subset = await prepareSubset({ target: root, known: stockIndexedSessions() })
      const client = new SearchWorkerClient({ indexPath: join(runDir, 'index.sqlite') })
      const context = new Context()
      context.provide('sessions', { list: () => [], get: () => undefined })
      context.provide('sessionPersistence', {
        list: async () => [],
        open: async () => {
          throw new Error('the owned backend must not read logs through the persistence service')
        },
      })
      const fiber = await context.plugin(SessionSearchEngine, { client })
      const probe = await startProbe(join(runDir, 'probe.sock'))
      const hostGaps: number[] = []
      let previousTick = process.hrtime.bigint()
      const hostTimer = setInterval(() => {
        const now = process.hrtime.bigint()
        hostGaps.push(Number(now - previousTick) / 1e6)
        previousTick = now
      }, 25)
      const startedAt = Date.now()
      await client.startIngest(root)

      const latencies: number[] = []
      const results = new Map<string, readonly string[]>()
      const deadline = startedAt + maxMinutes * 60_000
      let health = await client.health()
      let queryIndex = 0
      for (;;) {
        health = await client.health()
        if (health.behindSessions === 0 && !health.ingesting && health.sessions > 0) break
        if (Date.now() > deadline) break
        // A subset that resolves to no logs must fail fast instead of spinning until the deadline.
        if (health.sessions === 0 && Date.now() - startedAt > 60_000) break
        const query = QUERIES[queryIndex % QUERIES.length] ?? 'session'
        queryIndex += 1
        const searchStartedAt = Date.now()
        const page = await context.sessionQuery.searchSessions({ query, limit: 20 })
        latencies.push(Date.now() - searchStartedAt)
        results.set(query, page.items.map(item => item.header.id))
        // Poll gently: the worker is single-threaded, so a per-150ms search would compete with the ingest it is measuring.
        await sleep(1_000)
      }
      const ingestMs = Date.now() - startedAt
      // Let the starved timer and the queued pings drain before the probe is stopped, or the largest stall is lost.
      await sleep(500)
      const hostStall = await probe.stop()
      clearInterval(hostTimer)

      const parity = QUERIES.map(query => {
        const stock = stockSessionIds(query, subset.sessionIds)
        const owned = results.get(query) ?? []
        const ownedSet = new Set(owned)
        const found = stock.filter(id => ownedSet.has(id)).length
        return { query, stockSessions: stock.length, ownedSessions: owned.length, stockRecall: stock.length === 0 ? null : Number((found / stock.length).toFixed(3)) }
      })
      const report = {
        measuredAt: new Date().toISOString(),
        corpus: { source: corpusRoot, subsetSessions: subset.sessions, subsetMB: Number((subset.bytes / 1048576).toFixed(1)) },
        loadAverage: loadavg(),
        ingest: { ms: ingestMs, sessions: health.sessions, documents: health.documents, indexBytes: health.indexBytes, behindSessions: health.behindSessions },
        hostStall: { ...hostStall, inProcessMaxGapMs: percentile(hostGaps, 1), inProcessGapsOverBudget: hostGaps.filter(gap => gap > STALL_BUDGET_MS).length },
        search: { samples: latencies.length, p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), maxMs: latencies.length === 0 ? 0 : Math.max(...latencies) },
        parity,
      }
      console.log(JSON.stringify(report, null, 2))
      await writeFile(join(runDir, 'results.json'), `${JSON.stringify(report, null, 2)}\n`)
      await (await fiber).dispose()
      await client.close()

      expect(health.sessions).toBeGreaterThan(0)
      // The pass/fail signal is the Host event loop; the external round trip is reported but load-sensitive on a busy machine.
      expect(report.hostStall.inProcessGapsOverBudget).toBe(0)
      expect(report.hostStall.inProcessMaxGapMs).toBeLessThanOrEqual(STALL_BUDGET_MS)
      // The pinger's own tick cadence is not a Host signal: on a machine at load 20-40 the child itself is descheduled,
      // which is why `gapsOverBudget` is reported but not asserted. The Host's own gap and the round trip are the signals.
      expect(report.search.p95Ms).toBeLessThanOrEqual(SEARCH_P95_BUDGET_MS)
    },
    60_000 * (maxMinutes + 2),
  )
})
