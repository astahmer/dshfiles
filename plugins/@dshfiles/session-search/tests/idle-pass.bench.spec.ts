/**
 * What an idle ingest pass costs once the corpus is indexed: the worker repeats it every few seconds for the Host's
 * whole life, so it is a fixed CPU and disk-metadata tax even when no Session changes. Skipped unless `IDLE_BENCH=1`.
 *
 *   IDLE_BENCH=1 IDLE_BENCH_SESSIONS=2800 pnpm vitest run tests/idle-pass.bench.spec.ts
 */
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SearchIndex } from '../src/index-db.js'
import { runIngestPass } from '../src/ingest.js'
import { writeSessionLog } from './session-log-fixture.js'

const sessions = Number(process.env.IDLE_BENCH_SESSIONS ?? '2800')
const projects = 20
const passes = 30

describe.skipIf(process.env.IDLE_BENCH !== '1')('idle ingest pass', () => {
  it(`costs little on ${String(sessions)} indexed sessions`, { timeout: 600_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-search-idle-'))
    try {
      const corpus = join(root, 'sessions')
      for (let index = 0; index < sessions; index += 1) {
        const sessionId = `session-${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
        await writeSessionLog({ directory: join(corpus, `project-${String(index % projects)}`, sessionId), exchanges: 3, sessionId, framePerEvent: false })
      }
      // Linux only: bytes this process asked the kernel to write, the disk cost of the first build.
      const writeBytes = (): number => Number(/^write_bytes: (\d+)$/m.exec(readFileSync('/proc/self/io', 'utf8'))?.[1] ?? 0)
      const writtenBefore = writeBytes()
      const buildStartedAt = performance.now()
      const index = new SearchIndex(join(root, 'index.sqlite'))
      // The worker interleaves the backfills with ingest; a first build runs them until they report done.
      for (;;) {
        const backfilled = index.backfillConversation(2_000) && index.backfillRowMap(2_000)
        const result = await runIngestPass({ index, root: corpus, budgetMs: 60_000, windowBytes: 2 * 1024 * 1024, now: Date.now })
        if (backfilled && result.complete && result.behindSessions === 0) break
      }
      const firstBuildMs = Math.round(performance.now() - buildStartedAt)
      const firstBuildWrittenMb = Number(((writeBytes() - writtenBefore) / 1024 / 1024).toFixed(1))
      const indexMb = Number((statSync(join(root, 'index.sqlite')).size / 1024 / 1024).toFixed(1))
      const wall: number[] = []
      const cpu: number[] = []
      for (let pass = 0; pass < passes; pass += 1) {
        const startedAt = performance.now()
        const usage = process.cpuUsage()
        const result = await runIngestPass({ index, root: corpus, budgetMs: 1_000, windowBytes: 2 * 1024 * 1024, now: Date.now })
        const spent = process.cpuUsage(usage)
        wall.push(performance.now() - startedAt)
        cpu.push((spent.user + spent.system) / 1_000)
        expect(result.ingested).toBe(0)
      }
      const median = (values: readonly number[]): number => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0
      console.log(
        JSON.stringify({
          sessions,
          firstBuildMs,
          firstBuildWrittenMb,
          indexMb,
          wallMsMedian: Number(median(wall).toFixed(1)),
          cpuMsMedian: Number(median(cpu).toFixed(1)),
        }),
      )
      index.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
