import type { PromptStashSnapshot } from './library-api.js'

export class PromptLibraryQueries {
  static readonly key = ['prompt-stash', 'library'] as const

  static newest(current: PromptStashSnapshot | undefined, incoming: PromptStashSnapshot): PromptStashSnapshot {
    return current === undefined || incoming.revision >= current.revision ? incoming : current
  }
}
