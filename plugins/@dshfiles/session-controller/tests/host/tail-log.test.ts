import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, expect, it } from 'vitest'
import { TailLog } from '../../src/tail-log.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const header = { id: SessionId('tail-one'), createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0, version: 4 }

const row = (seq: number, extra: { readonly sourceEventSeqs?: readonly (number | readonly [number, number])[] } = {}): string =>
  `${JSON.stringify({ seq, time: 1_000 + seq, type: 'user/message', data: {}, ...extra })}\n`

const logOf = (frames: readonly string[]): Buffer => Buffer.concat(frames.map(text => zstdCompressSync(Buffer.from(text))))

const tailOver = async (bytes: Buffer): Promise<TailLog | undefined> => {
  const directory = mkdtempSync(join(tmpdir(), 'tail-log-'))
  directories.push(directory)
  const path = join(directory, 'session.v4.jsonl.zstd')
  writeFileSync(path, bytes)
  const ctx = new Context()
  // SAFETY: TailLog.open reads only stat and resolveCurrentLog from the JSONL backend.
  ctx.provide('sessionPersistence', { stat: async () => ({ header, formatStatus: 'current', revision: 'r' }), resolveCurrentLog: async () => path } as never)
  return TailLog.open({ ctx, sessionId: header.id, signal: new AbortController().signal })
}

it('decodes the newest frames first, joining a record the writer split across two appends', async () => {
  const split = row(3)
  const tail = await tailOver(
    logOf([`${JSON.stringify({ type: 'session', ...header })}\n`, row(0) + row(1), row(2) + split.slice(0, 10), split.slice(10), row(4)]),
  )
  if (tail === undefined) throw new Error('expected a tail')
  expect(tail.before(1).map(event => event.seq)).toEqual([4])
  expect(tail.complete).toBe(false)
  expect(tail.before(1).map(event => event.seq)).toEqual([2, 3, 4])
  expect(tail.before(8).map(event => event.seq)).toEqual([0, 1, 2, 3, 4])
  expect(tail.complete).toBe(true)
})

it('expands compressed sourceEventSeqs ranges back to the seqs the event lists', async () => {
  const tail = await tailOver(logOf(['{"type":"session"}\n', row(0) + row(1) + row(2), row(3, { sourceEventSeqs: [[0, 2]] })]))
  expect(tail?.before(1).at(-1)?.sourceEventSeqs).toEqual([0, 1, 2])
})

it('leaves a log whose last append is torn to the full read, which repairs it', async () => {
  const bytes = logOf(['{"type":"session"}\n', row(0), row(1)])
  await expect(tailOver(bytes.subarray(0, bytes.length - 3))).resolves.toBeUndefined()
  await expect(tailOver(logOf(['{"type":"session"}\n', row(0), row(1).slice(0, 8)]))).resolves.toBeUndefined()
})
