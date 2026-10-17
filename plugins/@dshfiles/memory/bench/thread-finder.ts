import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'

import { sessionContentHits } from '../src/session-content.ts'
import { openMemoryStore, type MemoryStore } from '../src/store.ts'
import { createThread } from '../src/testing/session-fixture.ts'
import { createThreadFinder, type ThreadFinderRecord } from '../src/thread-finder.ts'

/**
 * Retrieval benchmark for the unified finder: session only (titles + the installed FTS backend), memory only
 * (digests and indexed messages), and the composition. Run with `pnpm bench:finder`.
 *
 * The corpus is synthetic but real-shaped: every topic is one Session with a title, a user message that carries a
 * paraphrase, a digest, an indexed message, and a unique identifier. Recall is exact (one planted target), latency is
 * wall clock on this machine, and the related-candidate section measures labeled precision, not vibes.
 */

const now = Date.UTC(2026, 9, 17, 12)

const topics = [
  {
    slug: 'retry-storm',
    title: 'Retry storm cap',
    paraphrase: 'the gateway kept hammering the upstream after every failure',
    identifier: 'INC-20411',
    followUp: { title: 'Retry storm follow-up', paraphrase: 'the retry budget was exhausted again the next morning', identifier: 'INC-20451' },
  },
  {
    slug: 'rebase-conflicts',
    title: 'Rebase conflict sweep',
    paraphrase: 'two workspaces held divergent copies of the same change',
    identifier: 'INC-20412',
    followUp: { title: 'Rebase conflict recovery', paraphrase: 'the sweep left one revision pointing at the wrong parent', identifier: 'INC-20452' },
  },
  {
    slug: 'sqlite-observation',
    title: 'SQLite observation stability',
    paraphrase: 'the search index refused to settle while sessions kept writing',
    identifier: 'INC-20413',
    followUp: { title: 'SQLite observation retry', paraphrase: 'a second attempt cleared the unstable observation', identifier: 'INC-20453' },
  },
  {
    slug: 'attachment-upload',
    title: 'Attachment upload ordering',
    paraphrase: 'the message went out before the file finished uploading',
    identifier: 'INC-20414',
    followUp: { title: 'Attachment upload retry', paraphrase: 'the upload resumed once the guard waited', identifier: 'INC-20454' },
  },
  {
    slug: 'composer-drafts',
    title: 'Composer draft persistence',
    paraphrase: 'leaving a thread lost everything typed but not sent',
    identifier: 'INC-20415',
    followUp: { title: 'Composer draft reload', paraphrase: 'a reload wiped the stored draft again', identifier: 'INC-20455' },
  },
  {
    slug: 'plugin-boot',
    title: 'Plugin boot diagnostics',
    paraphrase: 'one broken plugin made four innocent ones look guilty',
    identifier: 'INC-20416',
    followUp: { title: 'Plugin boot ordering', paraphrase: 'the dependents were reported before the cause', identifier: 'INC-20456' },
  },
  {
    slug: 'menu-regressions',
    title: 'Menu keyboard regressions',
    paraphrase: 'the shortcut fired twice when a modal was open',
    identifier: 'INC-20417',
    followUp: { title: 'Menu keyboard scoping', paraphrase: 'the capture listener ignored the open dialog', identifier: 'INC-20457' },
  },
  {
    slug: 'queue-reorder',
    title: 'Queue reorder semantics',
    paraphrase: 'moving one queued message silently dropped another',
    identifier: 'INC-20418',
    followUp: { title: 'Queue reorder keys', paraphrase: 'the queue lost its stable ordering key', identifier: 'INC-20458' },
  },
  { slug: 'usage-pricing', title: 'Usage pricing cache', paraphrase: 'cost estimates were stale until the catalogue refreshed', identifier: 'INC-20419' },
  {
    slug: 'memory-retention',
    title: 'Memory retention window',
    paraphrase: 'old digests disappeared well before the configured horizon',
    identifier: 'INC-20420',
  },
  {
    slug: 'search-latency',
    title: 'Search latency budget',
    paraphrase: 'typing in the palette queued a corpus rebuild per keystroke',
    identifier: 'INC-20421',
  },
  {
    slug: 'workspace-isolation',
    title: 'Workspace isolation gaps',
    paraphrase: 'the checkout shared its node_modules with another workspace',
    identifier: 'INC-20422',
  },
  { slug: 'secret-rotation', title: 'Secret rotation runbook', paraphrase: 'the credential catalogue kept serving the retired key', identifier: 'INC-20423' },
  { slug: 'diff-viewed', title: 'Diff viewed markers', paraphrase: 'the review list forgot which files were already read', identifier: 'INC-20424' },
  {
    slug: 'multi-host-ssh',
    title: 'Multi host SSH readiness',
    paraphrase: 'the remote runtime reported ready before the socket existed',
    identifier: 'INC-20425',
  },
  { slug: 'jj-graph-page', title: 'JJ graph pagination', paraphrase: 'the revision graph cut off before the interesting commits', identifier: 'INC-20426' },
] as const

type Modelled = {
  readonly identifier: string
  readonly title: string
  readonly paraphrase: string
  readonly slug: string
  readonly sessionId: string
  readonly cwd: string
  readonly project: string
  /** Set on a follow-up Session that shares its seed's title words and working directory. */
  readonly siblingOf: string | null
}

const project = '/dev/dshfiles'

const corpus = (): readonly Modelled[] => {
  const entries: Modelled[] = []
  topics.forEach((topic, index) => {
    const sessionId = `session-${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`
    const cwd = `${project}/thread-${topic.slug}`
    entries.push({ identifier: topic.identifier, title: topic.title, paraphrase: topic.paraphrase, slug: topic.slug, sessionId, cwd, project, siblingOf: null })
    if ('followUp' in topic) {
      entries.push({
        identifier: topic.followUp.identifier,
        title: topic.followUp.title,
        paraphrase: topic.followUp.paraphrase,
        slug: `${topic.slug}-follow-up`,
        sessionId: `session-${String(900 + index).padStart(8, '0')}-0000-4000-8000-000000000000`,
        cwd,
        project,
        siblingOf: sessionId,
      })
    }
  })
  return entries
}

type Query = { readonly kind: 'identifier' | 'paraphrase' | 'title'; readonly query: string; readonly expected: string }

const queriesFor = (entries: readonly Modelled[]): readonly Query[] =>
  entries.flatMap(entry => [
    { kind: 'identifier' as const, query: entry.identifier, expected: entry.sessionId },
    { kind: 'paraphrase' as const, query: entry.paraphrase, expected: entry.sessionId },
    { kind: 'title' as const, query: entry.title, expected: entry.sessionId },
  ])

const stored = (entry: Modelled): { readonly header: SessionHeader; readonly events: readonly SessionEvent[] } => {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(entry.sessionId), createdAt: now, cwd: entry.cwd, isSeeded: false }
  const thread = createThread({ id: entry.sessionId, cwd: entry.cwd })
  thread.exchange(`${entry.paraphrase} (${entry.identifier})`, `Investigated ${entry.identifier}: ${entry.title.toLowerCase()} handled.`)
  thread.title(entry.title)
  return { header, events: [...thread.log().events] }
}

const stablePersistence = (entries: readonly { readonly header: SessionHeader; readonly events: readonly SessionEvent[] }[]) => ({
  list: async () => entries.map(entry => ({ header: structuredClone(entry.header), revision: 'revision-1' })),
  open: async (id: string) => {
    const entry = entries.find(candidate => candidate.header.id === id)
    if (entry === undefined) throw new Error(`no stored session ${id}`)
    return {
      id: entry.header.id,
      header: structuredClone(entry.header),
      inheritedEventCount: 0,
      read: async () => ({ eventState: 'shared-frozen' as const, events: structuredClone([...entry.events]) }),
      close: async () => {},
    }
  },
})

const indexMemory = (store: MemoryStore, entries: readonly Modelled[]): void => {
  entries.forEach((entry, index) => {
    store.putThread({
      id: entry.sessionId,
      project: entry.project,
      parent: null,
      title: entry.title,
      decision: `Resolved ${entry.identifier}.`,
      digest: `${entry.title} (${entry.identifier}): ${entry.paraphrase}.`,
      source: 'trail',
      lastSeq: 4,
      updatedAt: now - index * 3_600_000,
    })
    store.indexMessages({
      thread: entry.sessionId,
      project: entry.project,
      messages: [{ seq: 1, role: 'user', text: `${entry.paraphrase} ${entry.identifier}`, at: now - index * 3_600_000 }],
      throughSeq: 1,
    })
  })
}

const recordsFor = (entries: readonly Modelled[], withTitles: boolean): readonly ThreadFinderRecord[] =>
  entries.map((entry, index) => ({
    sessionId: entry.sessionId,
    title: withTitles ? entry.title : '',
    createdAt: now,
    updatedAt: now - index * 3_600_000,
    cwd: entry.cwd,
    project: entry.project,
    live: false,
    persisted: true,
    parentSessionId: null,
  }))

const percentile = (timings: readonly number[], fraction: number): number => {
  const sorted = [...timings].sort((left, right) => left - right)
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

const round = (value: number): number => Math.round(value * 100) / 100

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'memory-finder-bench-'))
  const entries = corpus()
  const store = openMemoryStore({ path: join(root, 'memory.db'), now: () => now })
  indexMemory(store, entries)
  const ctx = new Context()
  ctx.provide('sessions', { list: () => [], get: () => undefined })
  ctx.provide('sessionPersistence', stablePersistence(entries.map(stored)))
  await ctx.plugin(SqliteSessionQueryEngine, { path: join(root, 'index.sqlite'), openAt: 'first-search' })

  const memoryHits = (query: string, limit: number) =>
    store.search({ query, projects: [], ownProject: project, limit }).flatMap(hit =>
      hit.kind === 'thread'
        ? [
            {
              kind: 'digest' as const,
              sessionId: hit.id,
              project: hit.project,
              updatedAt: hit.updatedAt,
              title: store.thread(hit.id)?.title ?? '',
              text: store.thread(hit.id)?.digest ?? '',
              score: hit.score,
            },
          ]
        : hit.kind === 'message'
          ? [
              {
                kind: 'message' as const,
                sessionId: hit.thread,
                seq: hit.seq,
                role: hit.role,
                project: hit.project,
                updatedAt: hit.updatedAt,
                text: store.thread(hit.thread)?.digest ?? '',
                score: hit.score,
              },
            ]
          : [],
    )

  const modes = {
    session: { titles: true, content: true, memory: false },
    memory: { titles: false, content: false, memory: true },
    composed: { titles: true, content: true, memory: true },
  } as const

  const primaries = entries.filter(entry => entry.siblingOf === null)
  const queries = queriesFor(primaries)
  const report: string[] = []
  const failures: string[] = []
  for (const [mode, shape] of Object.entries(modes)) {
    const finder = createThreadFinder({
      listSessions: async () => recordsFor(entries, shape.titles),
      searchContent: shape.content
        ? async request => sessionContentHits(await ctx.sessionQuery.searchSessions({ query: request.query, limit: request.limit }))
        : async () => ({ hits: [], hasMore: false }),
      searchMemory: shape.memory ? async request => memoryHits(request.query, request.limit) : async () => [],
      readDigest: async sessionId => store.thread(sessionId)?.digest ?? null,
    })
    for (const kind of ['identifier', 'paraphrase', 'title'] as const) {
      const kindQueries = queries.filter(query => query.kind === kind)
      const timings: number[] = []
      let hit3 = 0
      let hit5 = 0
      for (const query of kindQueries) {
        const started = performance.now()
        const page = await finder.find({ query: query.query, projects: [project], ownProject: project, limit: 5 })
        timings.push(performance.now() - started)
        const ranked = page.hits.map(hit => hit.sessionId)
        if (ranked.slice(0, 3).includes(query.expected)) hit3 += 1
        if (ranked.includes(query.expected)) hit5 += 1
      }
      const recall3 = hit3 / kindQueries.length
      const recall5 = hit5 / kindQueries.length
      report.push(
        `${mode.padEnd(9)} ${kind.padEnd(11)} recall@3 ${round(recall3).toFixed(2)}  recall@5 ${round(recall5).toFixed(2)}  p50 ${round(percentile(timings, 0.5))}ms  p95 ${round(percentile(timings, 0.95))}ms`,
      )
      if (mode === 'composed' && recall5 < 1) failures.push(`composed recall@5 for ${kind} is ${round(recall5)}`)
      if (mode === 'session' && kind === 'paraphrase' && recall5 < 1) failures.push(`session-only paraphrase recall@5 is ${round(recall5)}`)
      if (mode === 'composed' && percentile(timings, 0.95) > 400) failures.push(`composed p95 for ${kind} is ${round(percentile(timings, 0.95))}ms`)
    }
  }

  // Labeled related-candidate precision: each pair shares topic words, everything else is noise.
  const pairs = primaries.flatMap(seed => {
    const sibling = entries.find(entry => entry.siblingOf === seed.sessionId)
    return sibling === undefined ? [] : [{ seed, sibling }]
  })

  let relevant = 0
  let returned = 0
  let found = 0
  const relatedFinder = createThreadFinder({
    listSessions: async () =>
      entries.map((entry, index) => ({
        ...recordsFor([entry], true)[0]!,
        updatedAt: now - index * 3_600_000,
        title: entry.title,
      })),
    searchContent: async () => ({ hits: [], hasMore: false }),
    searchMemory: async () => [],
    readDigest: async sessionId => store.thread(sessionId)?.digest ?? null,
  })
  for (const pair of pairs) {
    const relations = await relatedFinder.related({ sessionId: pair.seed.sessionId, projects: [project], limit: 5 })
    const ids = relations.inferred.map(hit => hit.sessionId)
    returned += ids.length
    if (ids.includes(pair.sibling.sessionId)) {
      relevant += 1
      found += 1
    }
  }
  const precision = returned === 0 ? 0 : relevant / returned
  report.push(`related   inferred precision@5 ${round(precision).toFixed(2)}  labeled recall ${round(found / pairs.length).toFixed(2)}`)
  if (found < pairs.length) failures.push(`related inference missed ${pairs.length - found} of ${pairs.length} labeled siblings`)

  console.log(report.join('\n'))
  await ctx.sessionQuery.close()
  store.close()
  rmSync(root, { recursive: true, force: true })
  if (failures.length > 0) {
    console.error(`\nFAILED:\n${failures.map(failure => `- ${failure}`).join('\n')}`)
    process.exitCode = 1
  }
}

await main()
