import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { legacySavedDraftSchema } from './legacy-saved-draft.js'
import { MAX_PROMPTS, PromptLibrary, promptSchema, type SavedPrompt } from './library.js'

export const promptStashDomain = defineDomain({
  name: 'prompt_stash',
  version: 1,
  tables: {
    prompts: { valueSchema: promptSchema, __key: 'prompts' },
    drafts: { valueSchema: legacySavedDraftSchema, __key: 'drafts' },
  },
})

export type PromptTable = KvTable<string, SavedPrompt>
export type PromptMutationKind = 'applied' | 'conflict' | 'limit'

export interface PromptMutation {
  readonly kind: PromptMutationKind
  readonly revision: number
  readonly prompts: SavedPrompt[]
}

export interface PromptStashSnapshot {
  readonly revision: number
  readonly prompts: SavedPrompt[]
}

export interface PromptStashStore {
  snapshot(): PromptStashSnapshot
  save(input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }): Promise<PromptMutation>
  remove(input: { readonly id: string; readonly expectedRevision: string }): Promise<PromptMutation>
  flush(): Promise<void>
}

/** Monotone across Host restarts: a new snapshot always outranks every revision a reader saw. */
const nextStashRevision = (current: number, now: number): number => Math.max(current + 1, now)

const byIdAscending = (left: { readonly id: string }, right: { readonly id: string }): number => left.id.localeCompare(right.id)

/** Newest edit first, so a saved or edited prompt sits where the composer list already shows it. */
const orderPrompts = (prompts: Iterable<SavedPrompt>): SavedPrompt[] =>
  [...prompts].sort((left, right) => right.updatedAt - left.updatedAt || byIdAscending(left, right))

/**
 * The Host's durable prompt library. The legacy drafts table remains declared so
 * existing stored rows survive the domain reopening without being exposed again.
 */
const createPromptStashStore = ({
  prompts,
  now = Date.now,
  reportError = error => console.error('Prompt stash write failed', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
}: {
  readonly prompts: PromptTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): PromptStashStore => {
  const promptRecords = new Map<string, SavedPrompt>(prompts.entries())
  let revision = Math.max(now(), ...[...promptRecords.values()].map(prompt => prompt.updatedAt))
  let writes: Promise<void> = Promise.resolve()

  const enqueue = (operation: () => Promise<void | boolean>): Promise<void> => {
    const result = writes.then(operation).then(() => undefined)
    writes = result.catch(() => undefined)
    return result
  }

  const promote = (): void => {
    revision = nextStashRevision(revision, now())
  }

  const snapshot = (): PromptStashSnapshot => ({ revision, prompts: orderPrompts(promptRecords.values()) })

  return {
    snapshot,
    save: async ({ prompt, expectedRevision }) => {
      const current = orderPrompts(promptRecords.values())
      const result = PromptLibrary.writeIfCurrent(current, prompt, expectedRevision)
      if (result.kind === 'conflict') return { kind: 'conflict', revision, prompts: current }
      if (!promptRecords.has(prompt.id) && promptRecords.size >= MAX_PROMPTS) return { kind: 'limit', revision, prompts: current }

      promptRecords.set(prompt.id, prompt)
      promote()
      await enqueue(() => prompts.put(prompt.id, prompt)).catch(reportError)
      return { kind: 'applied', revision, prompts: snapshot().prompts }
    },
    remove: async ({ id, expectedRevision }) => {
      const current = orderPrompts(promptRecords.values())
      if (PromptLibrary.removeIfCurrent(current, id, expectedRevision).kind === 'conflict') return { kind: 'conflict', revision, prompts: current }

      promptRecords.delete(id)
      promote()
      await enqueue(() => prompts.delete(id)).catch(reportError)
      return { kind: 'applied', revision, prompts: snapshot().prompts }
    },
    flush: () => writes,
  }
}

export class PromptStashModel {
  static readonly orderPrompts = orderPrompts
  static readonly createStore = createPromptStashStore
}
