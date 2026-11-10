import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openLogHead, recentLogEvents, TailLog } from './window.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** One turn as the Host writes it: a start marker, a user message that compresses poorly, an end marker. */
const turn = (index: number, firstSeq: number): SessionEvent[] => {
  const time = 1_000_000 + firstSeq
  // SAFETY: shapes copied from a stored v4 log; the backend validates every row on append and on read.
  return [
    { type: 'turn/start', seq: firstSeq, time, data: { turn: index } },
    {
      type: 'user/message',
      seq: firstSeq + 1,
      time,
      data: { content: [{ type: 'text', text: randomBytes(4_000).toString('hex') }], source: { kind: 'user' }, role: 'user', id: `message-${String(index)}` },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: firstSeq + 2, time, data: { turn: index, reason: { kind: 'interrupted' } } },
  ] as never
}

/** A 1 MB+ current-format log: ten turns per durable append, one zstd frame each, as a busy Agent's batches are. */
const writeLargeLog = async (sessionId: string, batches = 32) => {
  const root = mkdtempSync(join(tmpdir(), 'session-log-window-'))
  directories.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlPersistence, { root })
  const header: SessionHeader = { id: SessionId(sessionId), createdAt: 1, cwd: root, isSeeded: false, delegationDepth: 0, version: 4 } as never
  const writer = await ctx.sessionPersistence.create(header)
  for (let batch = 0; batch < batches; batch += 1) {
    await writer.append(Array.from({ length: 10 }, (_, offset) => turn(batch * 10 + offset + 1, (batch * 10 + offset) * 3)).flat())
  }
  await writer.close()
  return { ctx, header }
}

const storedEventsOf = async (ctx: Context, header: SessionHeader): Promise<readonly SessionEvent[]> => {
  const reader = await ctx.sessionPersistence.open(header.id, 'read')
  const read = (await reader.read()).events
  await reader.close()
  return read
}

it('decodes the same events as the full log read, from the newest frames back to the first', async () => {
  const { ctx, header } = await writeLargeLog('session-window-tail')
  const stored = await storedEventsOf(ctx, header)
  const metrics = { cache_hit: false }
  const tail = await TailLog.open({ ctx, sessionId: header.id, signal: new AbortController().signal, metrics })
  if (tail === undefined) throw new Error('expected the 1 MB+ log to open from its tail')

  expect(tail.before(1)).toEqual(stored.slice(-10 * 3))
  expect(tail.complete).toBe(false)
  for (let frames = 8; !tail.complete; frames *= 2) tail.before(frames)
  expect(tail.events).toEqual(stored)
  expect(metrics).toMatchObject({ cache_hit: false })
}, 30_000)

it('finds the newest matching events without decoding a log larger than the window', async () => {
  const { ctx, header } = await writeLargeLog('session-window-recent', 420)
  const stored = await storedEventsOf(ctx, header)
  const matches = (event: SessionEvent) => event.type === 'turn/end'
  const read = await recentLogEvents({ ctx, sessionId: header.id, signal: new AbortController().signal, metrics: {}, matches, keep: 4 })
  if (read === undefined) throw new Error('expected a bounded window of the 5 MB+ log')

  expect(read.complete).toBe(false)
  expect(read.events).toEqual(stored.filter(matches).slice(-4))
}, 60_000)

it('reads the first events of a log far larger than the head window', async () => {
  const { ctx, header } = await writeLargeLog('session-window-head', 420)
  const stored = await storedEventsOf(ctx, header)
  const head = await openLogHead({ ctx, sessionId: header.id, signal: new AbortController().signal, metrics: {} })
  if (head === undefined) throw new Error('expected a head window for the 5 MB+ log')

  expect(head.reachesLogEnd).toBe(false)
  expect(head.events).toEqual(stored.slice(0, head.events.length))
  expect(head.events.length).toBeGreaterThan(0)
}, 60_000)

it('reports a head window that covered the whole log', async () => {
  const { ctx, header } = await writeLargeLog('session-window-head-small', 1)
  const stored = await storedEventsOf(ctx, header)
  const head = await openLogHead({ ctx, sessionId: header.id, signal: new AbortController().signal, metrics: {} })
  if (head === undefined) throw new Error('expected a head window for the small log')

  expect(head.reachesLogEnd).toBe(true)
  expect(head.events).toEqual(stored)
}, 30_000)

it('refuses a tail for a log below the tail size before looking its file up', async () => {
  const { ctx, header } = await writeLargeLog('session-window-tail-small', 1)
  const metrics: Record<string, string | number | boolean | undefined> = {}
  const tail = await TailLog.open({ ctx, sessionId: header.id, signal: new AbortController().signal, metrics })
  expect(tail).toBeUndefined()
  expect(metrics.fallback_reason).toBe('below-tail-size-threshold')
  expect(metrics).not.toHaveProperty('lookup_ms')
}, 30_000)

it('answers undefined for a Host with no JSONL persistence backend', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const metrics = {}
  const tail = await TailLog.open({ ctx, sessionId: SessionId('session-window-missing-backend'), signal: new AbortController().signal, metrics })
  expect(tail).toBeUndefined()
  expect(metrics).toMatchObject({ fallback_reason: 'persistence-unavailable' })
  expect(await openLogHead({ ctx, sessionId: SessionId('session-window-missing-backend'), signal: new AbortController().signal, metrics: {} })).toBeUndefined()
}, 30_000)
