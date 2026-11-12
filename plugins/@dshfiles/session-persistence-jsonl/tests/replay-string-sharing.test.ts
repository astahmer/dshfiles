import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as ForkedJsonl from '../src/host.ts'

setFlagsFromString('--expose-gc')
// SAFETY: --expose-gc was set on the line above, so the fresh context's global `gc` is V8's collector.
const collectGarbage = runInNewContext('gc') as () => void

const MESSAGES = 400
const SIGNATURE_BYTES = 8 * 1024

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A provider reasoning item as the OpenAI Responses adapter serializes it into `thinkingSignature`. */
const signature = (index: number): string =>
  JSON.stringify({ type: 'reasoning', id: `rs_${index}`, summary: [], encrypted_content: randomBytes(SIGNATURE_BYTES * 0.75).toString('base64') })

/**
 * One settled turn in the shape written before the agent-loop fork: the reasoning signature sits on the message source
 * and again on the terminal stream chunk.
 */
const turn = (index: number): SessionEvent[] => {
  const replayState = { response: { id: `resp_${index}`, stopReason: 'stop' }, blocks: [{ thinkingSignature: signature(index) }] }
  const seq = index * 5
  const events = [
    { type: 'turn/start', seq: SessionSeq(seq), time: seq, data: { turn: index + 1 } },
    { type: 'step/start', seq: SessionSeq(seq + 1), time: seq, data: { turn: index + 1, step: 1 } },
    {
      type: 'assistant/message',
      seq: SessionSeq(seq + 2),
      time: seq,
      surfaceOp: 'append',
      data: {
        turn: index + 1,
        step: 1,
        message: {
          id: `m${index}`,
          role: 'assistant',
          content: [{ type: 'text', text: `answer ${index}` }],
          source: { kind: 'model', provider: 'openai', model: 'fixture', replayState },
        },
        stream: [{ type: 'chunk', time: seq, chunk: { type: 'finish', replayState: structuredClone(replayState) } }],
      },
    },
    { type: 'step/end', seq: SessionSeq(seq + 3), time: seq, data: { turn: index + 1, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(seq + 4), time: seq, data: { turn: index + 1, reason: { kind: 'completed' } } },
  ]
  // SAFETY: the rows follow the v4 relationships the scanner checks; the test reads them back through the real decoder.
  return events as unknown as SessionEvent[]
}

const storedLog = async (messages = MESSAGES) => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-jsonl-replay-'))
  roots.push(root)
  const ctx = new Context()
  const fiber = await ctx.plugin(ForkedJsonl, { root, compression: 'zstd' })
  disposers.push(() => fiber.dispose())
  const persistence = ctx.sessionPersistence
  const id = SessionId('session-replay')
  const handle = await persistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 1_760_000_000_000, cwd: '/tmp/replay', isSeeded: false, delegationDepth: 0 })
  for (let index = 0; index < messages; index += 1) await handle.append(turn(index))
  await handle.close()
  return { persistence, id }
}

const readEvents = async ({ persistence, id }: Awaited<ReturnType<typeof storedLog>>): Promise<readonly SessionEvent[]> => {
  const reader = await persistence.open(id, 'read')
  try {
    return (await reader.read()).events
  } finally {
    await reader.close()
  }
}

const heapAfterCollection = (): number => {
  collectGarbage()
  collectGarbage()
  return process.memoryUsage().heapUsed
}

it('keeps one copy of a replay signature a decoded log repeats', { timeout: 60_000 }, async () => {
  const stored = await storedLog()
  const before = heapAfterCollection()
  const events = await readEvents(stored)
  const retained = heapAfterCollection() - before

  const messages = events.filter(event => event.type === 'assistant/message')
  expect(messages).toHaveLength(MESSAGES)
  const uniqueSignatureBytes = messages.reduce((total, event) => {
    const source = JSON.stringify(event.data).match(/"thinkingSignature":"((?:[^"\\]|\\.)*)"/)?.[1] ?? ''
    return total + source.length
  }, 0)
  expect(uniqueSignatureBytes).toBeGreaterThan(MESSAGES * SIGNATURE_BYTES * 0.9)
  // Two independent copies of every signature would retain at least twice the unique bytes.
  expect(retained).toBeLessThan(uniqueSignatureBytes * 1.5)
})

it('reads back the same event values', async () => {
  const stored = await storedLog(2)
  const events = await readEvents(stored)
  const message = events.find(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') throw new Error('fixture has no assistant message')
  const finish = message.data.stream.at(-1)
  expect(finish?.type === 'chunk' ? finish.chunk : undefined).toEqual({ type: 'finish', replayState: message.data.message.source?.replayState })
})
