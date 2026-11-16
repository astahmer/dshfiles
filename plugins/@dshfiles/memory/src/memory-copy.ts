import type { MemoryUsage } from './api.ts'

type Retrieval = MemoryUsage['retrieval']

/** Page copy for Memory: plain words, no ranking algorithm and no tool name. */
export class MemoryCopy {
  /** One line per tab, at most 72 characters. */
  static readonly description = (tab: 'notes' | 'threads' | 'analytics'): string => {
    if (tab === 'threads') return 'Thread digests and the memories each one produced.'
    if (tab === 'analytics') return 'What memory costs and whether it holds up.'
    return 'What your agents remember, where it comes from, and how it is used.'
  }

  static readonly emptyNotes = 'No notes yet. Agents save one when you correct them.'

  /**
   * How search ranks is a setting, not a page fact, so a search that works as asked shows nothing. Only the fallback
   * (semantic search asked for, keyword search serving) is named, with where to change it.
   */
  static readonly searchNotice = (retrieval: Retrieval): { readonly label: string; readonly detail: string } | null => {
    if (retrieval.requested !== 'hybrid' || retrieval.active === 'hybrid') return null
    return {
      label: 'Semantic search unavailable',
      detail: `${retrieval.reason ?? 'The embedding provider did not load.'} Memory searches by keywords until it does; change it in Settings › Memory.`,
    }
  }

  /** How a thread digest was written, without naming the ranking algorithm. */
  static readonly digestSource = (source: string | null): string => (source === 'model' ? 'by a model' : 'from the transcript')
}
