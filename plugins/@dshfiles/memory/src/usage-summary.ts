import type { MemoryUsage } from './api.js'

/**
 * A bounded, model-facing answer to "is memory earning its keep?".
 *
 * The panel's `MemoryUsage` is far too wide to restate as a tool schema, and an
 * Agent does not need per-day series to decide whether retrieval works. This
 * projects the same numbers into a fixed set of counters and one short text
 * block, so `memory_usage` can exist without duplicating the analytics contract.
 */

export interface MemoryUsageSnapshot {
  readonly state: 'off' | 'ready' | 'failed'
  readonly failure: string | null
  readonly retrieval: { readonly active: 'bm25' | 'hybrid'; readonly reason: string | null }
  readonly days: number
  readonly threads: number
  readonly notes: number
  readonly noteCounts: { readonly active: number; readonly superseded: number; readonly forgotten: number }
  readonly indexedMessages: number
  readonly blocksServed: number
  readonly citations: number
  readonly digests: { readonly trail: number; readonly model: number; readonly duplicate: number; readonly trivial: number; readonly failures: number }
  readonly jev: { readonly calls: number; readonly inputTokens: number; readonly failures: number }
  readonly tools: readonly { readonly tool: string; readonly calls: number; readonly empty: number; readonly cited: number }[]
  readonly rated: { readonly up: number; readonly down: number; readonly agentCorrected: number; readonly userCorrected: number }
  readonly costUsd: number | null
  readonly topNotes: readonly { readonly id: number; readonly citations: number; readonly text: string }[]
}

const NOTE_CHARS = 80

export const snapshotOf = (usage: MemoryUsage, days: number): MemoryUsageSnapshot => ({
  state: usage.state,
  failure: usage.failure,
  retrieval: { active: usage.retrieval.active, reason: usage.retrieval.reason },
  days,
  threads: usage.threads,
  notes: usage.notes,
  noteCounts: usage.noteCounts,
  indexedMessages: usage.indexedMessages,
  blocksServed: usage.blocksServed,
  citations: usage.citations,
  digests: {
    trail: usage.digests.trail,
    model: usage.digests.model,
    duplicate: usage.digests.duplicate,
    trivial: usage.digests.trivial,
    failures: usage.digests.modelFailures,
  },
  jev: usage.jev,
  tools: [...usage.tools]
    .sort((left, right) => right.calls - left.calls)
    .slice(0, 5)
    .map(tool => ({ tool: tool.tool, calls: tool.calls, empty: tool.empty, cited: tool.used })),
  rated: {
    up: usage.effectiveness.citations.up,
    down: usage.effectiveness.citations.down,
    agentCorrected: usage.effectiveness.citations.agentCorrected,
    userCorrected: usage.effectiveness.citations.userCorrected,
  },
  costUsd: usage.costs.total.digest.usd,
  topNotes: usage.topNotes
    .slice(0, 5)
    .map(note => ({ id: note.id, citations: note.citations, text: note.text.replace(/\s+/g, ' ').trim().slice(0, NOTE_CHARS) })),
})

const count = (value: number): string => value.toLocaleString('en-US')

export const renderUsageSummary = (snapshot: MemoryUsageSnapshot): string => {
  const lines: string[] = []
  const retrieval =
    snapshot.retrieval.active === 'hybrid' ? 'hybrid (BM25 + embeddings)' : `BM25${snapshot.retrieval.reason === null ? '' : ` — ${snapshot.retrieval.reason}`}`
  lines.push(`memory: ${snapshot.state}${snapshot.failure === null ? '' : ` (${snapshot.failure})`} · retrieval ${retrieval}`)
  lines.push(
    `store: ${count(snapshot.threads)} threads · ${count(snapshot.notes)} notes (${count(snapshot.noteCounts.active)} valid, ${count(snapshot.noteCounts.superseded)} superseded, ${count(snapshot.noteCounts.forgotten)} forgotten) · ${count(snapshot.indexedMessages)} indexed messages`,
  )
  lines.push(`served: ${count(snapshot.blocksServed)} start blocks · ${count(snapshot.citations)} citations in replies, over ${String(snapshot.days)} days`)
  lines.push(
    `digests: ${count(snapshot.digests.trail)} from the Session trail, ${count(snapshot.digests.model)} from a model, ${count(snapshot.digests.duplicate)} duplicate, ${count(snapshot.digests.trivial)} trivial, ${count(snapshot.digests.failures)} failed`,
  )
  if (snapshot.tools.length > 0) {
    lines.push(
      `tools: ${snapshot.tools.map(tool => `${tool.tool} ${count(tool.calls)} calls (${count(tool.empty)} empty, ${count(tool.cited)} cited)`).join(' · ')}`,
    )
  }
  lines.push(
    `citations rated: ${count(snapshot.rated.up)} up · ${count(snapshot.rated.down)} down · ${count(snapshot.rated.agentCorrected)} agent-corrected · ${count(snapshot.rated.userCorrected)} user-corrected`,
  )
  const cost = snapshot.costUsd === null ? 'no known price' : `$${snapshot.costUsd.toFixed(2)}`
  lines.push(`memory's own cost: ${cost} over the window · Jev ${count(snapshot.jev.calls)} calls (${count(snapshot.jev.failures)} failed)`)
  if (snapshot.topNotes.length > 0)
    lines.push(`most cited: ${snapshot.topNotes.map(note => `n:${String(note.id)} "${note.text}" (${count(note.citations)})`).join(' · ')}`)
  lines.push('Counters are local to this host; a zero tool count means no memory tool was called in the window, not that memory is unused by other hosts.')
  return lines.join('\n')
}
