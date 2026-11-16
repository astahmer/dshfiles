import type { MemoryUsage } from './api.ts'
import { PanelFormat } from './panel-format.ts'

export interface AnalyticsCounter {
  readonly label: string
  readonly value: string
  readonly detail?: string
}

const plural = (count: number, word: string): string => `${PanelFormat.formatCount(count)} ${word}${count === 1 ? '' : 's'}`
const toolOf = (usage: MemoryUsage, name: string) => usage.tools.find(item => item.tool === name) ?? { calls: 0, withResults: 0, empty: 0, used: 0 }

/** What Memory › Analytics leads with: one sentence of state, then only the counters that are not zero. */
export class AnalyticsSummary {
  static readonly digestCalls = (usage: MemoryUsage): number => usage.digests.trail + usage.digests.model + usage.digests.duplicate

  /** "2 digests; nothing recalled yet." A state that needs the user (off, failed to start) is named first; healthy is not. */
  static readonly sentence = (usage: MemoryUsage): string => {
    if (usage.state === 'off') return 'Memory is off.'
    if (usage.state !== 'ready') return `Memory failed to start${usage.failure === null ? '' : `: ${usage.failure}`}.`
    const digests = AnalyticsSummary.digestCalls(usage)
    const searches = toolOf(usage, 'memory_search').calls
    const reads = toolOf(usage, 'memory_read').calls
    const recalled = searches + reads + usage.citations
    if (digests === 0 && recalled === 0) return 'Nothing recorded yet.'
    const cost = usage.costs.total.digest.usd
    const wrote = `${plural(digests, 'digest')}${cost !== null && cost > 0 ? ` (${PanelFormat.formatUsd(cost)})` : ''}`
    if (recalled === 0) return `${wrote}; nothing recalled yet.`
    return `${wrote}; ${plural(searches, 'search').replace(/searchs$/u, 'searches')}, ${plural(reads, 'read')} and ${plural(usage.citations, 'citation')}.`
  }

  /** Every counter the page used to tile, minus the ones that read zero. */
  static readonly counters = (usage: MemoryUsage): readonly AnalyticsCounter[] => {
    const search = toolOf(usage, 'memory_search')
    const read = toolOf(usage, 'memory_read')
    const block = usage.effectiveness.block
    const citations = usage.effectiveness.citations
    const digests = AnalyticsSummary.digestCalls(usage)
    const rows: readonly (AnalyticsCounter & { readonly count: number })[] = [
      {
        count: digests,
        label: 'Digest calls',
        value: PanelFormat.formatCount(digests),
        detail: `${PanelFormat.formatCount(usage.digests.model)} by a cheap model`,
      },
      {
        count: usage.costs.total.digest.usd ?? 0,
        label: 'Digest cost',
        value: PanelFormat.formatUsd(usage.costs.total.digest.usd),
        detail: `${PanelFormat.formatCount(usage.costs.total.digest.calls)} priced calls`,
      },
      { count: usage.jev.calls, label: 'Jev calls', value: PanelFormat.formatCount(usage.jev.calls), detail: PanelFormat.formatUsd(usage.costs.total.jev.usd) },
      {
        count: search.calls,
        label: 'Searches',
        value: PanelFormat.formatCount(search.calls),
        detail: `${PanelFormat.formatCount(search.withResults)} found · ${PanelFormat.formatCount(search.empty)} empty`,
      },
      {
        count: read.calls,
        label: 'Reads',
        value: PanelFormat.formatCount(read.calls),
        detail: `${PanelFormat.formatCount(read.withResults)} found · ${PanelFormat.formatCount(read.empty)} missing`,
      },
      {
        count: usage.citations,
        label: 'Citations',
        value: PanelFormat.formatCount(usage.citations),
        detail: `${PanelFormat.formatCount(citations.total)} cited memories`,
      },
      { count: citations.userCorrected, label: 'User corrections', value: PanelFormat.formatCount(citations.userCorrected), detail: 'heuristic signal' },
      {
        count: block.threads,
        label: 'Start blocks',
        value: PanelFormat.formatCount(block.threads),
        detail: `${PanelFormat.formatCount(usage.blocksServed)} total frozen`,
      },
      {
        count: block.meanBytes,
        label: 'Average block size',
        value: PanelFormat.formatBytes(block.meanBytes),
        detail: `largest ${PanelFormat.formatBytes(block.maxBytes)}`,
      },
      { count: block.requests, label: 'Model requests', value: PanelFormat.formatCount(block.requests), detail: 'carried a start block' },
    ]
    return rows.filter(row => row.count > 0).map(({ count: _count, ...row }) => row)
  }
}
