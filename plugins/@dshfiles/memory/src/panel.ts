import { JEV_INPUT_USD_PER_MILLION } from '@dshfiles/usage/api'
import { Effect } from 'effect'

import type { MemoryCostLine, MemoryCosts, MemoryEvent, MemoryUsage, PanelNote, PanelThread } from './api.ts'
import { MemorySettingsTag } from './embedder.ts'
import { MemoryRepo, type CostRow, type NoteRecord, type StoredThread } from './memory-repo.ts'
import { DigestPricing } from './pricing-promise.ts'
import { Recall } from './recall.ts'

const panelStatusOf = (note: NoteRecord): PanelNote['status'] => {
  if (note.archivedAt !== null) return 'archived'
  if (note.valid) return 'valid'
  if (note.forgottenAt !== null) return 'forgotten'
  return 'superseded'
}

export const panelNote = (note: NoteRecord): PanelNote => ({
  id: note.id,
  project: note.project,
  type: note.category,
  scope: note.scope,
  confidence: note.confidence,
  text: note.text,
  sourceThread: note.sourceThread,
  sourceSeq: note.sourceSeq,
  origin: note.origin,
  createdAt: note.firstCreatedAt,
  updatedAt: note.createdAt,
  citations: note.uses,
  status: panelStatusOf(note),
  archivedAt: note.archivedAt,
  supersedes: note.supersedes,
  supersededBy: note.supersededBy,
  reason: note.reason,
})

export const panelThread = (thread: StoredThread): PanelThread => ({
  id: thread.id,
  project: thread.project,
  title: thread.title,
  decision: thread.decision,
  digest: thread.digest,
  source: thread.source,
  updatedAt: thread.updatedAt,
  createdAt: thread.updatedAt,
  digestedAt: thread.digestedAt,
  digested: true,
  events: thread.lastSeq + 1,
  lastSeq: thread.lastSeq,
  citations: thread.uses,
})

const emptyCostLine = (): MemoryCostLine => ({ digest: { calls: 0, input: 0, cacheRead: 0, output: 0, usd: 0 }, jev: { calls: 0, input: 0, usd: 0 } })

const addCost = (line: MemoryCostLine, row: CostRow, usd: number | null): MemoryCostLine => {
  if (row.kind === 'jev')
    return {
      ...line,
      jev: { calls: line.jev.calls + row.calls, input: line.jev.input + row.input, usd: line.jev.usd + (row.input * JEV_INPUT_USD_PER_MILLION) / 1e6 },
    }
  return {
    ...line,
    digest: {
      calls: line.digest.calls + row.calls,
      input: line.digest.input + row.input,
      cacheRead: line.digest.cacheRead + row.cacheRead,
      output: line.digest.output + row.output,
      usd: line.digest.usd === null || usd === null ? null : line.digest.usd + usd,
    },
  }
}

const costs = Effect.fn('memory panel costs')(function* (days: number) {
  const repo = yield* MemoryRepo
  const pricing = yield* DigestPricing
  const byDay = new Map<string, MemoryCostLine>()
  let total = emptyCostLine()
  const priced = yield* Effect.forEach(yield* repo.costsByDay(days), row =>
    Effect.map(row.kind === 'digest' ? pricing.usd(row) : Effect.succeed(0), usd => ({ row, usd })),
  )
  for (const { row, usd } of priced) {
    byDay.set(row.day, addCost(byDay.get(row.day) ?? emptyCostLine(), row, usd))
    total = addCost(total, row, usd)
  }
  const result: MemoryCosts = { days: [...byDay].map(([day, line]) => ({ day, ...line })), total }
  return result
})

/** Recent citations, digests and note writes, newest first, for the analytics activity list. */
const recentEvents = Effect.fn('memory panel events')(function* (limit: number) {
  const repo = yield* MemoryRepo
  const threads = yield* repo.listThreads({ limit })
  const titles = new Map(threads.map(thread => [thread.id, thread.title]))
  const events: MemoryEvent[] = []
  for (const note of yield* repo.listNotes({ limit }))
    events.push({
      at: note.createdAt,
      kind: 'note',
      project: note.project,
      detail: note.text,
      thread: note.sourceThread,
      threadTitle: note.sourceThread === null ? null : (titles.get(note.sourceThread) ?? null),
      noteId: note.id,
      ref: `n:${note.id}`,
      rating: null,
      agentCorrected: false,
      userCorrected: false,
    })
  for (const thread of threads)
    events.push({
      at: thread.digestedAt,
      kind: 'digest',
      project: thread.project,
      detail: thread.title,
      thread: thread.id,
      threadTitle: thread.title,
      noteId: null,
      ref: `t:${thread.id}`,
      rating: null,
      agentCorrected: false,
      userCorrected: false,
    })
  for (const citation of yield* repo.recentCitations({ limit }))
    events.push({
      at: citation.at,
      kind: 'citation',
      project: citation.project ?? 'unknown',
      detail: citation.target ?? citation.ref,
      thread: citation.thread,
      threadTitle: citation.threadTitle,
      noteId: null,
      ref: citation.ref,
      rating: citation.rating,
      agentCorrected: citation.agentCorrected,
      userCorrected: citation.userCorrected,
    })
  return events.sort((left, right) => right.at - left.at).slice(0, limit)
})

const stored = Effect.fn('memory panel stored usage')(function* (days: number) {
  const repo = yield* MemoryRepo
  const counts = yield* repo.usage
  const counter = (name: string): number => counts.counters[name] ?? 0
  return {
    threads: counts.threads,
    notes: counts.notes,
    indexedMessages: counts.indexedMessages,
    blocksServed: counter('blocks.served'),
    citations: counter('citations'),
    digests: {
      trail: counter('digests.trail'),
      model: counter('digests.model'),
      duplicate: counter('digests.duplicate'),
      trivial: counter('digests.skippedTrivial'),
      modelFailures: counter('digests.modelFailures'),
    },
    jev: { calls: counter('jev.calls'), inputTokens: counter('jev.inputTokens'), failures: counter('jev.failures') },
    tools: counts.tools,
    costs: yield* costs(days),
    effectiveness: yield* repo.effectiveness,
    noteCounts: yield* repo.noteStatusCounts(),
    daily: yield* repo.usageByDay(days),
    events: yield* recentEvents(40),
    topNotes: (yield* repo.topNotes(8)).map(panelNote),
  }
})

const emptyStore = {
  threads: 0,
  notes: 0,
  indexedMessages: 0,
  blocksServed: 0,
  citations: 0,
  digests: { trail: 0, model: 0, duplicate: 0, trivial: 0, modelFailures: 0 },
  jev: { calls: 0, inputTokens: 0, failures: 0 },
  tools: [],
  costs: { days: [], total: emptyCostLine() },
  effectiveness: {
    block: { threads: 0, meanBytes: 0, maxBytes: 0, requests: 0 },
    citations: { total: 0, agentCorrected: 0, userCorrected: 0, up: 0, down: 0 },
  },
  noteCounts: { active: 0, superseded: 0, forgotten: 0, archived: 0 },
  daily: [],
  events: [],
  topNotes: [],
}

/** Whether memory earns its keep; a store that never opened reports `failed` with its reason instead of failing the panel. */
export const memoryUsage = Effect.fn('memory panel usage')(function* (days: number) {
  const settings = yield* MemorySettingsTag
  const recall = yield* Recall
  const enabled = (yield* settings.get).enabled
  const retrieval = yield* recall.retrievalStatus
  const counts = yield* Effect.result(stored(days))
  if (counts._tag === 'Success') {
    const usage: MemoryUsage = { state: enabled ? 'ready' : 'off', failure: null, retrieval, ...counts.success }
    return usage
  }
  if (counts.failure._tag !== 'MemoryInactive') return yield* counts.failure
  const usage: MemoryUsage = { state: 'failed', failure: counts.failure.reason, retrieval, ...emptyStore }
  return usage
})
