import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, expect, it } from 'vitest'
import { recentTranscript, recentTranscriptFromTail, type TranscriptTail } from '../../src/session-transcript.ts'
import { TailLog } from '../../src/tail-log.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const user = (seq: number, text: string): SessionEvent =>
  ({ seq, type: 'user/message', time: 1_000 + seq, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } }) as unknown as SessionEvent

const assistant = (seq: number, text: string): SessionEvent =>
  ({ seq, type: 'assistant/message', time: 1_000 + seq, data: { message: { content: [{ type: 'text', text }] } } }) as unknown as SessionEvent

const tool = (seq: number): SessionEvent =>
  ({ seq, type: 'tool/result', time: 1_000 + seq, data: { callId: `call-${String(seq)}`, isError: false, content: [] } }) as unknown as SessionEvent

it('reads the newest spoken entries oldest first and reports whether older ones exist', () => {
  const events = [tool(0), user(1, 'first question'), assistant(2, 'first answer'), tool(3), user(4, 'second question'), assistant(5, 'second answer')]
  expect(recentTranscript({ events, limit: 2 })).toEqual({
    entries: [{ seq: 4, role: 'user', text: 'second question' }, { seq: 5, role: 'assistant', text: 'second answer' }],
    truncated: true,
  })
  expect(recentTranscript({ events, limit: 3 })).toMatchObject({
    entries: [{ seq: 2, role: 'assistant', text: 'first answer' }, { seq: 4, role: 'user', text: 'second question' }, { seq: 5, role: 'assistant', text: 'second answer' }],
    truncated: true,
  })
  expect(recentTranscript({ events, limit: 6 })).toMatchObject({ truncated: false })
})

it('keeps synthetic inputs out and clips one entry to the published maximum', () => {
  const reminder = { seq: 3, type: 'user/message', time: 1_003, data: { content: [{ type: 'text', text: 'reminder' }], source: { kind: 'runtime' } } } as unknown as SessionEvent
  const long = recentTranscript({ events: [reminder, user(1, 'x'.repeat(9_000))], limit: 5 })
  expect(long.truncated).toBe(false)
  expect(long.entries).toHaveLength(1)
  expect(long.entries[0]?.text.endsWith('…')).toBe(true)
  expect(long.entries[0]?.text).toHaveLength(8_001)
})

it('stops decoding the tail once more entries than the caller asked for are decoded', () => {
  let reads = 0
  const reader: TranscriptTail = {
    before: () => {
      reads += 1
      return [user(4, 'four'), assistant(5, 'five'), user(6, 'six')]
    },
    complete: false,
    decodedFrames: 3,
  }
  expect(recentTranscriptFromTail({ tail: reader, limit: 2 })).toEqual({
    entries: [{ seq: 5, role: 'assistant', text: 'five' }, { seq: 6, role: 'user', text: 'six' }],
    truncated: true,
  })
  expect(reads).toBe(1)
})

it('answers the whole decoded window when it reaches the start of the log', () => {
  const reader: TranscriptTail = { before: () => [assistant(1, 'only')], complete: true, decodedFrames: 1 }
  expect(recentTranscriptFromTail({ tail: reader, limit: 2 })).toEqual({
    entries: [{ seq: 1, role: 'assistant', text: 'only' }],
    truncated: false,
  })
})

it('falls back to the full read when the decoded window holds nothing further back', () => {
  const stalled: TranscriptTail = { before: () => [assistant(1, 'only')], complete: false, decodedFrames: 1 }
  expect(recentTranscriptFromTail({ tail: stalled, limit: 2 })).toBeUndefined()
})

it('answers the same transcript as the full read of a cold log', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-transcript-'))
  directories.push(directory)
  const path = join(directory, 'session.v4.jsonl.zstd')
  const header = { id: SessionId('transcript-one'), createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0, version: 4 }
  const frames: Buffer[] = [zstdCompressSync(Buffer.from(`${JSON.stringify({ type: 'session', ...header })}\n`))]
  const events: SessionEvent[] = []
  for (let seq = 0; seq < 400; seq += 1) {
    const event = seq % 3 === 0 ? user(seq, `question ${String(seq)}`) : seq % 3 === 1 ? assistant(seq, `answer ${String(seq)}`) : tool(seq)
    events.push(event)
    frames.push(zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`)))
  }
  writeFileSync(path, Buffer.concat(frames))
  const ctx = new Context()
  // SAFETY: TailLog.open reads only stat and resolveCurrentLog from the JSONL backend.
  ctx.provide('sessionPersistence', {
    stat: async () => ({ header, formatStatus: 'current', revision: 'r', sizeBytes: 100_000_000 }),
    resolveCurrentLog: async () => path,
  } as never)
  const tail = await TailLog.open({ ctx, sessionId: header.id, signal: new AbortController().signal })
  if (tail === undefined) throw new Error('expected a tail')
  const fromTail = recentTranscriptFromTail({ tail, limit: 20 })
  expect(fromTail).toEqual(recentTranscript({ events, limit: 20 }))
  expect(fromTail?.entries).toHaveLength(20)
  expect(tail.decodedFrames).toBeLessThanOrEqual(frames.length)
})
