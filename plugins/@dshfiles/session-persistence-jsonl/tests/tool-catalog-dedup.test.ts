import { stat, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Plugin } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, foldRequestHeader } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as StockJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as ForkedJsonl from '../src/host.ts'
import { logPath, TOOL_CATALOG_REFERENCE } from '../src/native/format.ts'
import { verifyJsonlCurrentGeneration } from '../src/native/generation.ts'
import type { JsonlCompression } from '../src/native/format.ts'
import { decompressZstdFrame, scanZstdFrames } from '../src/native/zstd.ts'

/** One assembled tool catalog, at the size the 455-tool web preset produces. */
const TOOL_COUNT = 455
const SERIES_COUNT = 34

const catalog = (): ToolSchema[] =>
  Array.from({ length: TOOL_COUNT }, (_tool, index) => ({
    name: `tool-${index}`,
    description: `Tool ${index} of the assembled catalog: reads, writes or inspects one bounded part of the workspace so the model can answer a question about it.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path inside the workspace.' },
        limit: { type: 'number', description: 'Maximum entries to return.' },
      },
      required: index % 2 === 0 ? ['path'] : ['path', 'limit'],
      additionalProperties: false,
    },
  }))

const roots: string[] = []
const mounted: Mounted[] = []

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-jsonl-catalogs-'))
  roots.push(root)
  return root
}

interface Mounted {
  readonly ctx: Context
  readonly persistence: SessionPersistence
  readonly dispose: () => Promise<void>
}

const mount = async (plugin: Plugin, root: string, compression: JsonlCompression): Promise<Mounted> => {
  const ctx = new Context()
  const fiber = await ctx.plugin(plugin, { root, compression })
  const instance: Mounted = {
    ctx,
    persistence: ctx.sessionPersistence,
    dispose: async () => {
      const index = mounted.indexOf(instance)
      if (index >= 0) mounted.splice(index, 1)
      await fiber.dispose()
    },
  }
  mounted.push(instance)
  return instance
}

const cwd = '/tmp/dshfiles-catalog-fixture'

const sessionHeader = (id: string): SessionHeader => ({
  version: SESSION_FORMAT_VERSION,
  id: SessionId(id),
  createdAt: 1_760_000_000_000,
  cwd,
  isSeeded: false,
  delegationDepth: 0,
})

/** One request-series boundary: open turn, full header snapshot, close turn. */
const seriesBatch = (tools: ToolSchema[], turn: number, firstSeq: number): SessionEvent[] => {
  const at = (seq: number): number => 1_760_000_000_000 + seq
  const header: SessionEvent = {
    type: 'request/header',
    seq: SessionSeq(firstSeq + 1),
    time: at(firstSeq + 1),
    data:
      turn === 1
        ? { header: { config: { provider: 'fixture', model: 'fixture-model' }, tools }, reason: 'initial' }
        : { header: { config: { provider: 'fixture', model: 'fixture-model' }, tools }, reason: 'series', startsSeries: true },
  }
  return [
    { type: 'turn/start', seq: SessionSeq(firstSeq), time: at(firstSeq), data: { turn } },
    header,
    { type: 'turn/end', seq: SessionSeq(firstSeq + 2), time: at(firstSeq + 2), data: { turn, reason: { kind: 'completed' } } },
  ]
}

/** Write one series per append, the way the live loop reaches the backend. */
const writeSeries = async (
  persistence: SessionPersistence,
  id: string,
  tools: ToolSchema[],
  series: number,
  startTurn = 1,
  reopen = false,
): Promise<SessionHandle> => {
  const target = reopen ? await persistence.open(SessionId(id), 'write') : await persistence.create(sessionHeader(id))
  let seq = (startTurn - 1) * 3
  for (let index = 0; index < series; index += 1) {
    const batch = seriesBatch(tools, startTurn + index, seq)
    await target.append(batch)
    seq += batch.length
  }
  return target
}

const artifactPath = (root: string, id: string, compression: JsonlCompression): string => logPath(root, cwd, SessionId(id), compression)

const readSession = async (persistence: SessionPersistence, id: string): Promise<readonly SessionEvent[]> => {
  const handle: SessionHandle = await persistence.open(SessionId(id), 'read')
  try {
    const result = await handle.read()
    return result.events
  } finally {
    await handle.close()
  }
}

const diskText = async (path: string): Promise<string> => readFile(path, 'utf8')

const fullCatalogRows = (text: string): number => text.split('"tools":[').length - 1
const catalogReferences = (text: string): number => text.split(`{"${TOOL_CATALOG_REFERENCE}":`).length - 1

const toolsOf = (events: readonly SessionEvent[]): readonly ToolSchema[] => foldRequestHeader(events)?.tools ?? []

afterEach(async () => {
  await Promise.all(mounted.splice(0).map(instance => instance.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('request-header tool catalog dedupe', () => {
  it('stores one catalog, reads it back for every series, and shrinks the artifact', async () => {
    const tools = catalog()

    const stockRoot = await makeRoot()
    const stock = await mount(StockJsonl, stockRoot, 'none')
    const stockHandle = await writeSeries(stock.persistence, 'session-stock', tools, SERIES_COUNT)
    await stockHandle.flush()
    await stockHandle.close()
    const stockPath = artifactPath(stockRoot, 'session-stock', 'none')
    const stockBytes = (await stat(stockPath)).size
    const stockRead = await readSession(stock.persistence, 'session-stock')
    await stock.dispose()

    const forkRoot = await makeRoot()
    const fork = await mount(ForkedJsonl, forkRoot, 'none')
    const forkHandle = await writeSeries(fork.persistence, 'session-fork', tools, SERIES_COUNT)
    await forkHandle.flush()
    await forkHandle.close()
    const forkPath = artifactPath(forkRoot, 'session-fork', 'none')
    const forkBytes = (await stat(forkPath)).size
    const forkRead = await readSession(fork.persistence, 'session-fork')
    await fork.dispose()

    const stockText = await diskText(stockPath)
    const forkText = await diskText(forkPath)

    // The stock backend writes one full 455-tool catalog per series; the fork writes one plus a reference each.
    expect(fullCatalogRows(stockText)).toBe(SERIES_COUNT)
    expect(fullCatalogRows(forkText)).toBe(1)
    expect(catalogReferences(forkText)).toBe(SERIES_COUNT - 1)
    expect(forkText).toContain('"dshfilesCatalogDedupe":1')
    expect(stockText).not.toContain('dshfilesCatalogDedupe')
    expect(forkBytes).toBeLessThan(stockBytes / 5)

    // Every reader sees exactly the events the stock backend stored: same headers, same catalogs.
    expect(forkRead).toEqual(stockRead)
    expect(toolsOf(forkRead)).toEqual(tools)
    expect(toolsOf(forkRead)).toHaveLength(TOOL_COUNT)

    console.info(
      JSON.stringify({
        series: SERIES_COUNT,
        tools: TOOL_COUNT,
        catalogBytes: JSON.stringify(tools).length,
        stockBytes,
        forkBytes,
        savedBytes: stockBytes - forkBytes,
        savedShare: Number(((stockBytes - forkBytes) / stockBytes).toFixed(4)),
        fullCatalogRows: fullCatalogRows(forkText),
        catalogReferences: catalogReferences(forkText),
      }),
    )
  })

  it('reads a pre-fork log identically and refuses a pre-fork harness on a deduped one', async () => {
    const tools = catalog()

    const legacyRoot = await makeRoot()
    const stockWriter = await mount(StockJsonl, legacyRoot, 'none')
    const legacyHandle = await writeSeries(stockWriter.persistence, 'session-legacy', tools, 3)
    await legacyHandle.close()
    const legacyRead = await readSession(stockWriter.persistence, 'session-legacy')
    await stockWriter.dispose()

    // A log written before the fork keeps its old shape and reads through the fork unchanged.
    const legacyPath = artifactPath(legacyRoot, 'session-legacy', 'none')
    expect(await diskText(legacyPath)).not.toContain('dshfilesCatalogDedupe')
    const forkReader = await mount(ForkedJsonl, legacyRoot, 'none')
    expect(await readSession(forkReader.persistence, 'session-legacy')).toEqual(legacyRead)
    await forkReader.dispose()

    const dedupedRoot = await makeRoot()
    const forkWriter = await mount(ForkedJsonl, dedupedRoot, 'none')
    const dedupedHandle = await writeSeries(forkWriter.persistence, 'session-deduped', tools, 3)
    await dedupedHandle.close()
    const dedupedRead = await readSession(forkWriter.persistence, 'session-deduped')
    await forkWriter.dispose()

    expect(await diskText(artifactPath(dedupedRoot, 'session-deduped', 'none'))).toContain('dshfilesCatalogDedupe')

    // A harness without this fork refuses the marked artifact instead of reading a reference as no tools.
    const preFork = await mount(StockJsonl, dedupedRoot, 'none')
    await expect(readSession(preFork.persistence, 'session-deduped')).rejects.toThrow()
    // Its listing skips the header it cannot classify rather than reporting the Session as tool-less.
    expect((await preFork.persistence.list()).map(snapshot => snapshot.header.id)).not.toContain(SessionId('session-deduped'))
    await preFork.dispose()

    // ... and the fork's own header probe lists and stats the artifact after that refusal.
    const forkAgain = await mount(ForkedJsonl, dedupedRoot, 'none')
    expect(await readSession(forkAgain.persistence, 'session-deduped')).toEqual(dedupedRead)
    expect(toolsOf(dedupedRead)).toHaveLength(TOOL_COUNT)
    expect((await forkAgain.persistence.list()).map(snapshot => snapshot.header.id)).toContain(SessionId('session-deduped'))
    const stat = await forkAgain.persistence.stat(SessionId('session-deduped'))
    expect(stat?.header.id).toBe(SessionId('session-deduped'))
    // The strict current-generation verifier the migration worker runs restores a whole Session from the
    // artifact: rehydrated marker rows must satisfy the Session-level validation, not just the read seam.
    const verified = await verifyJsonlCurrentGeneration(artifactPath(dedupedRoot, 'session-deduped', 'none'), 'none', 'session-deduped', 9)
    expect(verified.bytes).toBeGreaterThan(0)
    await forkAgain.dispose()
  })

  it('dedupes inside compressed generations and across a reopened writer', async () => {
    const tools = catalog()

    const stockRoot = await makeRoot()
    const stock = await mount(StockJsonl, stockRoot, 'zstd')
    const stockHandle = await writeSeries(stock.persistence, 'session-stock-zstd', tools, 4)
    await stockHandle.close()
    const stockPath = artifactPath(stockRoot, 'session-stock-zstd', 'zstd')
    const stockBytes = (await stat(stockPath)).size
    const stockRead = await readSession(stock.persistence, 'session-stock-zstd')
    await stock.dispose()

    const forkRoot = await makeRoot()
    const fork = await mount(ForkedJsonl, forkRoot, 'zstd')
    const first = await writeSeries(fork.persistence, 'session-fork-zstd', tools, 2)
    await first.close()
    // A reopened writer does not know the previous process's catalogs, so it pays one full catalog and
    // references its own later series — never a reference to bytes it did not write.
    await fork.dispose()
    const reopened = await mount(ForkedJsonl, forkRoot, 'zstd')
    const second = await writeSeries(reopened.persistence, 'session-fork-zstd', tools, 2, 3, true)
    await second.close()
    const forkPath = artifactPath(forkRoot, 'session-fork-zstd', 'zstd')
    const forkBytes = (await stat(forkPath)).size
    const forkRead = await readSession(reopened.persistence, 'session-fork-zstd')
    await reopened.dispose()

    expect(forkBytes).toBeLessThan(stockBytes)
    expect(forkRead).toEqual(stockRead)
    expect(toolsOf(forkRead)).toHaveLength(TOOL_COUNT)
    expect(forkRead).toHaveLength(12)

    // Two writer processes wrote this artifact: one full catalog each, one reference each.
    const bytes = await readFile(forkPath)
    const frames = scanZstdFrames(bytes).frames
    const plaintext = Buffer.concat(await Promise.all(frames.map(frame => decompressZstdFrame(bytes.subarray(frame.start, frame.end))))).toString('utf8')
    expect(fullCatalogRows(plaintext)).toBe(2)
    expect(catalogReferences(plaintext)).toBe(2)

    console.info(
      JSON.stringify({
        container: 'zstd',
        series: 4,
        catalogBytes: JSON.stringify(tools).length,
        stockBytes,
        forkBytes,
        savedBytes: stockBytes - forkBytes,
        savedShare: Number(((stockBytes - forkBytes) / stockBytes).toFixed(4)),
        fullCatalogRows: fullCatalogRows(plaintext),
        catalogReferences: catalogReferences(plaintext),
      }),
    )
  })
})
