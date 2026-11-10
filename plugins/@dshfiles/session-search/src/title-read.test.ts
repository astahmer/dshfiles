import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { readBoundedTitle, readLiveTitle } from './title-read.js'

const directories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const header = { id: SessionId('title-one'), createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0, version: 4 } as SessionHeader

const titleRow = (seq: number, title: string): string =>
  `${JSON.stringify({ seq, time: 1_000 + seq, type: 'session/title', data: { title, messageSeqs: [], source: { kind: 'fallback' } } })}\n`

/** A stored header row, the title a Session starts with, and `body` incompressible appends of `appendBytes` each. */
const logOf = (input: { readonly body: number; readonly appendBytes: number }): Buffer => {
  const frames = [`${JSON.stringify({ type: 'session', ...header })}\n`, titleRow(0, 'Early title')]
  for (let index = 0; index < input.body; index += 1) {
    frames.push(
      `${JSON.stringify({ seq: index + 1, time: 1_001 + index, type: 'user/message', data: { text: randomBytes(input.appendBytes).toString('hex') } })}\n`,
    )
  }
  return Buffer.concat(frames.map(text => zstdCompressSync(Buffer.from(text), { level: 1 })))
}

/** Larger than a head window but smaller than a tail window: the log's title is beyond the head, its tail is whole. */
const mediumLog = (() => {
  let cached: Buffer | undefined
  return () => (cached ??= logOf({ body: 3, appendBytes: 120_000 }))
})()

/** Larger than a tail window: no bounded window holds the whole log any more. */
const largeLog = (() => {
  let cached: Buffer | undefined
  return () => (cached ??= logOf({ body: 6, appendBytes: 700_000 }))
})()

const renamedLog = (): Buffer => Buffer.concat([mediumLog(), zstdCompressSync(Buffer.from(titleRow(4, 'Renamed title')))])
const smallLog = (): Buffer =>
  Buffer.concat([`${JSON.stringify({ type: 'session', ...header })}\n`, titleRow(0, 'Early title')].map(text => zstdCompressSync(Buffer.from(text))))

const openContext = async (bytes: Buffer, cache?: { readonly title: string | null; readonly asOfSeq: number }) => {
  const directory = mkdtempSync(join(tmpdir(), 'title-read-'))
  directories.push(directory)
  const path = join(directory, 'session.v4.jsonl.zstd')
  writeFileSync(path, bytes)
  const ctx = new Context()
  contexts.push(ctx)
  // SAFETY: the bounded read calls only stat and resolveCurrentLog; `open` stays a spy that records whether any read
  // decoded the whole log.
  ctx.provide('sessionPersistence', {
    stat: async () => ({ header, formatStatus: 'current', revision: 'r', sizeBytes: bytes.length }),
    resolveCurrentLog: async () => path,
    open: async () => {
      throw new Error('a bounded title read must never open the log')
    },
  } as never)
  if (cache !== undefined) {
    const cachedSnapshot = () => ({ asOfSeq: cache.asOfSeq, values: { title: cache.title } })
    const cachedPredecessorTitle = () => undefined
    // SAFETY: the read uses the cache's two title faces and nothing else of the service.
    ctx.provide('sessionProjectionCache', { cachedSnapshot, cachedPredecessorTitle } as never)
  }
  return { ctx }
}

const signal = () => new AbortController().signal

it('answers a title beyond the head window when the checkpoint covers the log end', async () => {
  const bytes = mediumLog()
  expect(bytes.length).toBeGreaterThan(256_000)
  expect(bytes.length).toBeLessThan(4_000_000)
  const { ctx } = await openContext(bytes, { title: 'Early title', asOfSeq: 3 })
  const open = vi.spyOn(ctx.sessionPersistence, 'open')

  const result = await readBoundedTitle({ ctx, sessionId: header.id, signal: signal() })

  expect(result?.session.id).toBe(header.id)
  expect(result?.title).toMatchObject({ title: 'Early title', eventSeq: 0, source: { kind: 'fallback' } })
  expect(open).not.toHaveBeenCalled()
}, 30_000)

it('finds a title a Session was renamed near the end of its log', async () => {
  const { ctx } = await openContext(renamedLog(), { title: 'Early title', asOfSeq: 2 })

  const result = await readBoundedTitle({ ctx, sessionId: header.id, signal: signal() })

  expect(result?.title).toMatchObject({ title: 'Renamed title', eventSeq: 4 })
}, 30_000)

it('answers undefined when no checkpoint can prove the title a log larger than a tail window starts with', async () => {
  const bytes = largeLog()
  expect(bytes.length).toBeGreaterThan(4_000_000)
  const { ctx } = await openContext(bytes)

  await expect(readBoundedTitle({ ctx, sessionId: header.id, signal: signal() })).resolves.toBeUndefined()
}, 30_000)

it('folds the whole log when the window covers it', async () => {
  const { ctx } = await openContext(smallLog())

  const result = await readBoundedTitle({ ctx, sessionId: header.id, signal: signal() })

  const expected = foldSessionTitle([
    { seq: 0, time: 1_000, type: 'session/title', data: { title: 'Early title', messageSeqs: [], source: { kind: 'fallback' } } },
  ] as never)
  expect(result?.title).toEqual(expected)
}, 30_000)

/** A live Session's event surface: its header, its cursor, and slices of its append-only log. */
const liveSession = () => {
  const log: unknown[] = [JSON.parse(titleRow(0, 'Early title'))]
  for (let seq = 1; seq < 2_000; seq += 1) log.push({ seq, time: 1_000 + seq, type: 'user/message', data: { text: `turn ${seq}` } })
  const slices: (readonly [number, number])[] = []
  const snapshotEvents = (from = 0, to = log.length) => {
    slices.push([from, to])
    return log.slice(from, to)
  }
  // SAFETY: the live title read uses only the header, the cursor and `snapshotEvents`.
  const session = {
    header,
    get seq() {
      return log.length
    },
    snapshotEvents,
  } as never
  return { log, session, slices }
}

it('folds a live Session title from the events appended since its last read', () => {
  const { log, session, slices } = liveSession()
  expect(readLiveTitle(session).title).toEqual(foldSessionTitle(log as never))
  const scanned = slices.reduce((sum, [from, to]) => sum + to - from, 0)
  expect(scanned).toBe(log.length)

  slices.splice(0)
  log.push(JSON.parse(titleRow(2_000, 'Renamed title')), { seq: 2_001, time: 3_001, type: 'user/message', data: { text: 'after' } })
  expect(readLiveTitle(session).title).toMatchObject({ title: 'Renamed title', eventSeq: 2_000 })
  expect(slices).toEqual([[2_000, 2_002]])

  slices.splice(0)
  log.push({ seq: 2_002, time: 3_002, type: 'user/message', data: { text: 'later' } })
  expect(readLiveTitle(session).title).toEqual(foldSessionTitle(log as never))
  expect(slices).toEqual([[2_002, 2_003]])
})
