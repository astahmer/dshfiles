import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { SessionLogs, type SessionLogRef } from './self-improve-log.ts'
import { SessionMiner, type SessionFacts } from './self-improve-mine.ts'

/**
 * One windowed, cached read of the Session corpus.
 *
 * Both `mine` and `review` scan the same logs, so the discovery, the window
 * filter, the extraction cache and the pool live here once. The cache is keyed
 * by log path plus size and mtime, which makes a second window over the same
 * corpus cheap: only Sessions new to the cache are decoded.
 */

const cacheSchema = z.object({
  version: z.number(),
  entries: z.record(z.string(), z.object({ size: z.number(), mtimeMs: z.number(), facts: SessionMiner.factsSchema })),
})
export type CorpusCache = z.infer<typeof cacheSchema>

export interface CorpusOptions {
  dshHome: string
  cachePath?: string
  sinceMs?: number
  untilMs?: number
  projects: readonly string[]
  /** Newest-first cap on the Sessions read; `Number.POSITIVE_INFINITY` reads every one in the window. */
  sessionLimit: number
  onUnreadable?: (input: { readonly path: string; readonly error: unknown }) => void
}

export interface CorpusResult {
  readonly discovered: number
  readonly selected: readonly SessionLogRef[]
  readonly facts: readonly SessionFacts[]
  readonly reused: number
  readonly failed: number
  readonly skippedByWindow: number
}

const emptyCache = (): CorpusCache => ({ version: SessionMiner.EXTRACTOR_VERSION, entries: {} })

const loadCache = async (path: string | undefined): Promise<CorpusCache> => {
  if (path === undefined) return emptyCache()
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) return emptyCache()
  const parsed = SessionLogs.decodeJsonSafe(cacheSchema, text)
  if (parsed === undefined || parsed.version !== SessionMiner.EXTRACTOR_VERSION) return emptyCache()
  return parsed
}

const mapPool = async <Item, Result>(items: readonly Item[], width: number, worker: (item: Item) => Promise<Result>): Promise<Result[]> => {
  const results: Result[] = new Array<Result>(items.length)
  let next = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++
      const item = items[index]
      if (item === undefined) return
      results[index] = await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, run))
  return results
}

const inWindow = (ref: SessionLogRef, options: CorpusOptions): boolean => {
  if (options.sinceMs !== undefined && ref.mtimeMs < options.sinceMs) return false
  if (options.untilMs !== undefined && ref.mtimeMs >= options.untilMs) return false
  if (options.projects.length > 0 && !options.projects.some(project => ref.project.includes(project))) return false
  return true
}

const load = async (options: CorpusOptions): Promise<CorpusResult> => {
  const discovered = await SessionLogs.discover(join(options.dshHome, 'sessions'))
  const windowed = discovered.filter(ref => inWindow(ref, options))
  const selected = windowed.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, options.sessionLimit === 0 ? windowed.length : options.sessionLimit)

  const cache = await loadCache(options.cachePath)
  let reused = 0
  let failed = 0
  const extracted = await mapPool(selected, 8, async (ref): Promise<SessionFacts | undefined> => {
    const cached = cache.entries[ref.path]
    if (cached !== undefined && cached.size === ref.size && cached.mtimeMs === ref.mtimeMs) {
      reused += 1
      return cached.facts
    }
    const facts = await SessionMiner.extract(ref).catch(error => {
      failed += 1
      options.onUnreadable?.({ path: ref.path, error })
      return undefined
    })
    if (facts !== undefined) cache.entries[ref.path] = { size: ref.size, mtimeMs: ref.mtimeMs, facts }
    return facts
  })

  if (options.cachePath !== undefined) {
    await mkdir(resolve(options.cachePath, '..'), { recursive: true })
    await writeFile(options.cachePath, JSON.stringify(cache))
  }

  return {
    discovered: discovered.length,
    selected,
    facts: extracted.filter((entry): entry is SessionFacts => entry !== undefined),
    reused,
    failed,
    skippedByWindow: discovered.length - windowed.length,
  }
}

export class SessionCorpus {
  static readonly load = load
  static readonly cacheSchema = cacheSchema
  static readonly emptyCache = emptyCache
}
