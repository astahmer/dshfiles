import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Plugin } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, foldRequestHeader } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as StockJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as ForkedJsonl from '../src/host.ts'
import { logPath, scanLog, TOOL_CATALOG_REFERENCE } from '../src/native/format.ts'

const catalogHashes = vi.hoisted(() => ({ count: 0 }))

vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    createHash: (algorithm: string) => {
      const hash = actual.createHash(algorithm)
      const update = hash.update.bind(hash)
      hash.update = ((data: string | Buffer, ...rest: []) => {
        if (typeof data === 'string' && data.startsWith('[')) catalogHashes.count += 1
        return update(data, ...rest)
      }) as typeof hash.update
      return hash
    },
  }
})

const SERIES_COUNT = 5
const cwd = '/tmp/dshfiles-catalog-lazy-fixture'

const tools: ToolSchema[] = Array.from({ length: 40 }, (_tool, index) => ({
  name: `tool-${index}`,
  description: `Tool ${index}`,
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
}))

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const writeLog = async (plugin: Plugin, id: string): Promise<Buffer> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-jsonl-lazy-'))
  roots.push(root)
  const ctx = new Context()
  const fiber = await ctx.plugin(plugin, { root, compression: 'none' })
  disposers.push(() => fiber.dispose())
  const handle = await ctx.sessionPersistence.create({
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1_760_000_000_000,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  })
  for (let turn = 1; turn <= SERIES_COUNT; turn += 1) {
    const seq = (turn - 1) * 3
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(seq), time: seq, data: { turn } },
      {
        type: 'request/header',
        seq: SessionSeq(seq + 1),
        time: seq + 1,
        data: turn === 1
          ? { header: { config: { provider: 'fixture', model: 'fixture-model' }, tools }, reason: 'initial' }
          : { header: { config: { provider: 'fixture', model: 'fixture-model' }, tools }, reason: 'series', startsSeries: true },
      },
      { type: 'turn/end', seq: SessionSeq(seq + 2), time: seq + 2, data: { turn, reason: { kind: 'completed' } } },
    ]
    await handle.append(events)
  }
  await handle.close()
  return readFile(logPath(root, cwd, SessionId(id), 'none'))
}

const headerTools = (events: readonly SessionEvent[]): unknown[] =>
  events.flatMap(event => (event.type === 'request/header' ? [event.data.header.tools] : []))

describe('tool catalog digests', () => {
  it('decodes full catalogs without hashing them when no row references one', async () => {
    const bytes = await writeLog(StockJsonl, 'session-legacy')
    expect(bytes.toString('utf8')).not.toContain(TOOL_CATALOG_REFERENCE)

    catalogHashes.count = 0
    const { events } = scanLog(bytes)

    expect(catalogHashes.count).toBe(0)
    expect(headerTools(events)).toEqual(Array.from({ length: SERIES_COUNT }, () => tools))
  })

  it('hashes the referenced catalog once and resolves every reference', async () => {
    const bytes = await writeLog(ForkedJsonl, 'session-deduped')
    expect(bytes.toString('utf8').split(`{"${TOOL_CATALOG_REFERENCE}":`)).toHaveLength(SERIES_COUNT)

    catalogHashes.count = 0
    const { events } = scanLog(bytes)

    expect(catalogHashes.count).toBe(1)
    expect(headerTools(events)).toEqual(Array.from({ length: SERIES_COUNT }, () => tools))
    expect(foldRequestHeader(events)?.tools).toEqual(tools)
  })
})
