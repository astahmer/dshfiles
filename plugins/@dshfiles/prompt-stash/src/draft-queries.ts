import type { DraftSnapshot } from './library-api.js'

export class PromptDraftQueries {
  private constructor() {}

  static readonly key = ['prompt-stash', 'drafts'] as const

  static readonly newest = (current: DraftSnapshot | undefined, incoming: DraftSnapshot): DraftSnapshot =>
    current === undefined || incoming.revision >= current.revision ? incoming : current
}
