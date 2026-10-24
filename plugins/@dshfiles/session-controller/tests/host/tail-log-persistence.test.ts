import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, expect, it } from 'vitest'
import { TailLog } from '../../src/tail-log.ts'

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
const writeLargeLog = async (sessionId: string) => {
  const root = mkdtempSync(join(tmpdir(), 'tail-log-jsonl-'))
  directories.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlPersistence, { root })
  const header: SessionHeader = { id: SessionId(sessionId), createdAt: 1, cwd: root, isSeeded: false, delegationDepth: 0, version: 4 } as never
  const writer = await ctx.sessionPersistence.create(header)
  for (let batch = 0; batch < 32; batch += 1) {
    await writer.append(Array.from({ length: 10 }, (_, offset) => turn(batch * 10 + offset + 1, (batch * 10 + offset) * 3)).flat())
  }
  await writer.close()
  return { ctx, header }
}

it('decodes the same events as the JSONL backend, from the newest frames back to the first', async () => {
  const { ctx, header } = await writeLargeLog('session-tail-check')
  const reader = await ctx.sessionPersistence.open(header.id, 'read')
  const stored = (await reader.read()).events
  await reader.close()
  const stat = await ctx.sessionPersistence.stat(header.id)
  expect(stat).toMatchObject({ formatStatus: 'current' })
  expect(stat?.sizeBytes).toBeGreaterThan(1_000_000)
  const tail = await TailLog.open({ ctx, sessionId: header.id, signal: new AbortController().signal })
  if (tail === undefined) throw new Error('expected the 1 MB+ log to open from its tail')

  expect(tail.before(1)).toEqual(stored.slice(-10 * 3))
  expect(tail.complete).toBe(false)
  for (let frames = 8; !tail.complete; frames *= 2) tail.before(frames)
  expect(tail.events).toEqual(stored)
}, 30_000)

it('records a session tail read span with the thread, bytes and frames it read', async () => {
  const { ctx, header } = await writeLargeLog('session-tail-span')
  using recorder = recordSpans()
  await TailLog.open({ ctx, sessionId: header.id, signal: new AbortController().signal })
  const span = recorder.span('session tail read')
  expect(span.attributes).toMatchObject({ 'dsh.session.id': 'session-tail-span', 'dshx.session-controller.served': true, 'dshx.session-controller.frames': 33 })
  expect(span.attributes['dshx.session-controller.bytes']).toBeGreaterThan(1_000_000)
}, 30_000)
