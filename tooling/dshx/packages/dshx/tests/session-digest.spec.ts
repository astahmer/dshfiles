import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.js'
import { createDshPlatformClientFromTransport } from '../src/platform/client.js'
import type { DshPlatformClient, JsonValue } from '../src/platform/client.js'
import { SessionDigestModel } from '../src/platform/session-digest.js'

const fixtureSchema = z.object({
  summary: z.object({
    sessionId: z.string(),
    updatedAt: z.number(),
    running: z.boolean(),
    blank: z.boolean(),
    agentAvailable: z.boolean(),
    cwd: z.string().optional(),
    projections: z.json().optional(),
  }),
  records: z.array(z.json()),
})

// Captured from a scratch DSH driven by a scripted Messages endpoint; paths rewritten to /tmp/dshx-digest.
const loadFixture = (name: string) => {
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(new URL(`./fixtures/session-digest/${name}.json`, import.meta.url), 'utf8')))
  return {
    summary: {
      sessionId: fixture.summary.sessionId,
      updatedAt: fixture.summary.updatedAt,
      running: fixture.summary.running,
      blank: fixture.summary.blank,
      agentAvailable: fixture.summary.agentAvailable,
      ...(fixture.summary.cwd !== undefined && { cwd: fixture.summary.cwd }),
      ...(fixture.summary.projections !== undefined && { projections: fixture.summary.projections }),
    },
    records: fixture.records,
  }
}

const recordSeq = (record: JsonValue): number => z.object({ event: z.object({ seq: z.number() }) }).parse(record).event.seq
const lastTime = (records: readonly JsonValue[]): number => z.object({ event: z.object({ time: z.number() }) }).parse(records.at(-1)).event.time

/** Serves fixture records through the real paging client, recording which pages were read. */
const fixtureClient = (fixture: ReturnType<typeof loadFixture>, pageReads: number[] = []): DshPlatformClient =>
  createDshPlatformClientFromTransport({
    sessionCursor: async () => recordSeq(fixture.records.at(-1) ?? null),
    rpc: async (namespace, method, args) => {
      if (namespace === 'session' && method === 'list') return { items: [fixture.summary] }
      if (namespace !== 'session' || method !== 'page') throw new Error(`Unexpected RPC ${namespace}/${method}`)
      const request = z.object({ throughSeq: z.number(), beforeSeq: z.number().optional(), maxMessages: z.number() }).parse(args.request)
      const eligible = fixture.records.filter(
        record => recordSeq(record) <= request.throughSeq && (request.beforeSeq === undefined || recordSeq(record) < request.beforeSeq),
      )
      const pageSize = 20
      pageReads.push(request.beforeSeq ?? -1)
      return { records: eligible.slice(-pageSize), hasMore: eligible.length > pageSize }
    },
  })

const streams = () => {
  const out = new PassThrough()
  const err = new PassThrough()
  let stdout = ''
  out.on('data', chunk => {
    stdout += chunk.toString()
  })
  return { io: { stdin: new PassThrough(), stdout: out, stderr: err }, stdout: () => stdout }
}

describe('sessions digest', () => {
  it('shows a running agent waiting on its slow check, its plan, its describe, and the edit that silently failed', () => {
    const fixture = loadFixture('relay-running')
    const now = lastTime(fixture.records) + 5_000
    const digest = SessionDigestModel.digest({ ...fixture, now })

    expect(digest.running).toBe(true)
    expect(digest.todos).toEqual([
      { content: 'Rename greet to welcome', status: 'completed' },
      { content: 'Run the slow integration check', status: 'in_progress' },
    ])
    expect(digest.actions.at(-1)).toMatchObject({ status: 'pending', summary: 'bash: sleep 25; echo integration ok' })
    expect(digest.actions.find(action => action.tool === 'bash' && action.summary.includes('ls src'))?.summary).toBe('bash: ls src')
    expect(digest.revisions.map(revision => [revision.command, revision.message])).toEqual([
      ['jj describe', 'refactor(app): rename greet to welcome'],
      ['jj new', undefined],
    ])
    expect(digest.filesChanged).toEqual([])
    expect(digest.failures.recent).toEqual([
      expect.objectContaining({ summary: 'edit src/greeting.mjs', error: expect.stringContaining('file has not been read') }),
    ])
    expect(digest.attention).toEqual([])
  })

  it('flags a long wait on a pending tool call', () => {
    const fixture = loadFixture('relay-running')
    const digest = SessionDigestModel.digest({ ...fixture, now: lastTime(fixture.records) + 5 * 60_000 })

    expect(digest.attention).toEqual([expect.stringMatching(/^waiting 5m on #\d+ bash: sleep 25/)])
  })

  it('flags an agent that keeps answering goal rounds without doing anything', () => {
    const fixture = loadFixture('goal-loop')
    const digest = SessionDigestModel.digest({ ...fixture, now: lastTime(fixture.records) + 1_000 })

    expect(digest.attention).toContainEqual(expect.stringMatching(/^\d+ turns since the last tool call \(#111\); latest reply: Nothing left to do\.$/))
    expect(digest.goal?.objective).toBe('Ship a tested greeting module in the scratch app and describe it as one jj revision.')
    expect(digest.filesChanged.map(file => [file.path, file.edits])).toEqual([
      ['src/farewell.mjs', 1],
      ['src/greeting.test.mjs', 2],
      ['src/greeting.mjs', 2],
    ])
    expect(digest.revisions[0]).toMatchObject({ command: 'jj describe', message: 'feat(app): add a tested greeting module', status: 'ok' })
    expect(digest.undescribedEdits).toEqual({ sinceSeq: digest.revisions[0]?.seq, edits: 1, files: 1 })
    expect(digest.failures.recent.map(failure => failure.error)).toEqual([
      'exit 1: AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
      'cannot read "src/missing.mjs": not found',
      'exit 3: (no output)',
    ])
    expect(digest.intents.at(-1)).toBe('Summarising the blocker')
  })

  it('reports compaction, the last reply, and a todo the finished agent left open', () => {
    const fixture = loadFixture('relay-done')
    const digest = SessionDigestModel.digest({ ...fixture, now: lastTime(fixture.records) + 1_000 })

    expect(digest.running).toBe(false)
    expect(digest.compactions).toBe(1)
    expect(digest.lastUserPrompt?.text).toBe('Anything else to change?')
    expect(digest.lastAssistantText?.text).toBe('Nothing left to do.')
    expect(digest.lastTurnEnd).toMatchObject({ kind: 'completed' })
    expect(digest.attention).toEqual(['idle with 1 open todos'])
  })

  it('renders each captured session within a one-screen budget', () => {
    for (const name of ['relay-running', 'goal-loop', 'relay-done']) {
      const fixture = loadFixture(name)
      const now = lastTime(fixture.records)
      const text = SessionDigestModel.render(SessionDigestModel.digest({ ...fixture, now }), now)
      expect(text.split('\n').length).toBeLessThanOrEqual(60)
      expect(text).toContain('Recent actions')
    }
  })
})

describe('sessions tail', () => {
  it('names the tool behind each result and hides per-step bookkeeping', () => {
    const fixture = loadFixture('relay-done')
    const describe = SessionDigestModel.createEventDescriber()
    const lines = fixture.records.filter(record => !SessionDigestModel.isNoiseEvent(record)).flatMap(record => describe(record) ?? [])

    expect(lines.some(line => line.type === 'step/start' || line.type === 'request/context')).toBe(false)
    expect(lines.find(line => line.type === 'tool/result' && line.summary.includes('integration ok'))?.summary).toMatch(/^↳ bash ok \d+\.\ds: integration ok$/)
    expect(lines.find(line => line.type === 'user/message')?.summary).toBe('user: Rename greet to welcome, describe it, then run the slow integration check.')
  })

  it('reads only the newest pages it needs for --tail', async () => {
    const fixture = loadFixture('goal-loop')
    const pageReads: number[] = []
    const output = streams()
    const exitCode = await runCli(['sessions', 'tail', fixture.summary.sessionId, '--tail', '3', '--types', 'turn'], {
      io: output.io,
      version: 'test-version',
      runtime: { connectPlatform: async () => fixtureClient(fixture, pageReads) },
    })

    expect(exitCode).toBe(0)
    expect(
      output
        .stdout()
        .trim()
        .split('\n')
        .map(line => line.split(/\s+/)[2]),
    ).toEqual(['turn/end', 'turn/start', 'turn/end'])
    expect(pageReads.length).toBeLessThan(3)
  })
})

describe('sessions export filters', () => {
  it('keeps only matching events after --since-seq and stops paging there', async () => {
    const fixture = loadFixture('goal-loop')
    const pageReads: number[] = []
    const output = streams()
    const exitCode = await runCli(['sessions', 'export', fixture.summary.sessionId, '--since-seq', '100', '--types', 'tool,goal/change', '--json'], {
      io: output.io,
      version: 'test-version',
      runtime: { connectPlatform: async () => fixtureClient(fixture, pageReads) },
    })
    const records = z
      .object({ data: z.object({ records: z.array(z.object({ event: z.object({ seq: z.number(), type: z.string() }) })) }) })
      .parse(JSON.parse(output.stdout())).data.records

    expect(exitCode).toBe(0)
    expect(records.map(record => record.event.type)).toEqual(['tool/call', 'tool/result', 'tool/call', 'tool/result'])
    expect(records.every(record => record.event.seq > 100)).toBe(true)
    expect(pageReads.at(-1)).toBeGreaterThan(100)
  })

  it('returns the newest matching events in ascending order for --tail', async () => {
    const fixture = loadFixture('relay-done')
    const output = streams()
    await runCli(['sessions', 'export', fixture.summary.sessionId, '--tail', '2', '--types', 'tool/call', '--json'], {
      io: output.io,
      version: 'test-version',
      runtime: { connectPlatform: async () => fixtureClient(fixture) },
    })
    const records = z
      .object({ data: z.object({ records: z.array(z.object({ event: z.object({ seq: z.number(), type: z.string() }) })) }) })
      .parse(JSON.parse(output.stdout())).data.records

    expect(records.map(record => record.event.type)).toEqual(['tool/call', 'tool/call'])
    expect(records[0]!.event.seq).toBeLessThan(records[1]!.event.seq)
  })
})
