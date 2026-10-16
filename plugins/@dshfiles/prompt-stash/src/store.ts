import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  removeDraft as removeDraftEntry,
  saveDraft as saveDraftEntry,
  savedDraftSchema,
  type DraftStore,
  type SaveDraftResult,
  type SavedDraft,
} from './draft-store.js'
import { MAX_PROMPTS, promptSchema, removePromptIfCurrent, writePromptIfCurrent, type SavedPrompt } from './library.js'

export const promptStashDomain = defineDomain({
  name: 'prompt_stash',
  version: 1,
  tables: {
    prompts: { valueSchema: promptSchema, __key: 'prompts' },
    drafts: { valueSchema: savedDraftSchema, __key: 'drafts' },
  },
})

export type PromptTable = KvTable<string, SavedPrompt>
export type DraftTable = KvTable<string, SavedDraft>

export type PromptMutationKind = 'applied' | 'conflict' | 'limit'
export type DraftRejectionReason = Extract<SaveDraftResult, { ok: false }>['reason']

export interface PromptMutation {
  readonly kind: PromptMutationKind
  readonly revision: number
  readonly prompts: SavedPrompt[]
}

export type DraftMutation =
  | { readonly kind: 'applied'; readonly revision: number; readonly drafts: SavedDraft[] }
  | { readonly kind: 'rejected'; readonly reason: DraftRejectionReason; readonly revision: number; readonly drafts: SavedDraft[] }

export interface PromptStashSnapshot {
  readonly revision: number
  readonly prompts: SavedPrompt[]
}

export interface DraftSnapshot {
  readonly revision: number
  readonly drafts: SavedDraft[]
}

export interface DraftInput {
  readonly id: string
  readonly title: string
  readonly text: string
  readonly now: string
}

export interface PromptStashStore {
  snapshot(): PromptStashSnapshot
  draftsSnapshot(): DraftSnapshot
  save(input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }): Promise<PromptMutation>
  remove(input: { readonly id: string; readonly expectedRevision: string }): Promise<PromptMutation>
  saveDraft(draft: DraftInput): Promise<DraftMutation>
  removeDraft(id: string): Promise<DraftSnapshot>
  flush(): Promise<void>
}

/** Monotone across Host restarts: a new snapshot always outranks every revision a reader saw. */
const nextStashRevision = (current: number, now: number): number => Math.max(current + 1, now)

const byIdAscending = (left: { readonly id: string }, right: { readonly id: string }): number => left.id.localeCompare(right.id)

/** Newest edit first, so a saved or edited prompt sits where the composer list already shows it. */
export const orderPrompts = (prompts: Iterable<SavedPrompt>): SavedPrompt[] =>
  [...prompts].sort((left, right) => right.updatedAt - left.updatedAt || byIdAscending(left, right))

export const orderDrafts = (drafts: Iterable<SavedDraft>): SavedDraft[] =>
  [...drafts].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || byIdAscending(left, right))

const draftStoreOf = (drafts: SavedDraft[]): DraftStore => ({ schemaVersion: 1, drafts })

/**
 * The Host's durable prompt library and saved drafts, backed by two storage-domain
 * tables. Every browser, plugin and CLI reads the same rows; the prompt library
 * keeps its per-prompt revision for conflict detection.
 */
export const createPromptStashStore = ({
  prompts,
  drafts,
  now = Date.now,
  reportError = error => console.error('Prompt stash write failed', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
}: {
  readonly prompts: PromptTable
  readonly drafts: DraftTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): PromptStashStore => {
  const promptRecords = new Map<string, SavedPrompt>(prompts.entries())
  const draftRecords = new Map<string, SavedDraft>(drafts.entries())
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
  const draftsSnapshot = (): DraftSnapshot => ({ revision, drafts: orderDrafts(draftRecords.values()) })

  return {
    snapshot,
    draftsSnapshot,
    save: async ({ prompt, expectedRevision }) => {
      const current = orderPrompts(promptRecords.values())
      const result = writePromptIfCurrent(current, prompt, expectedRevision)
      if (result.kind === 'conflict') return { kind: 'conflict', revision, prompts: current }
      if (!promptRecords.has(prompt.id) && promptRecords.size >= MAX_PROMPTS) return { kind: 'limit', revision, prompts: current }

      promptRecords.set(prompt.id, prompt)
      promote()
      await enqueue(() => prompts.put(prompt.id, prompt)).catch(reportError)
      return { kind: 'applied', revision, prompts: snapshot().prompts }
    },
    remove: async ({ id, expectedRevision }) => {
      const current = orderPrompts(promptRecords.values())
      if (removePromptIfCurrent(current, id, expectedRevision).kind === 'conflict') return { kind: 'conflict', revision, prompts: current }

      promptRecords.delete(id)
      promote()
      await enqueue(() => prompts.delete(id)).catch(reportError)
      return { kind: 'applied', revision, prompts: snapshot().prompts }
    },
    saveDraft: async draft => {
      const result = saveDraftEntry(draftStoreOf(orderDrafts(draftRecords.values())), draft)
      if (!result.ok) return { kind: 'rejected', reason: result.reason, revision, drafts: orderDrafts(draftRecords.values()) }

      const saved = result.store.drafts.find(item => item.id === draft.id)
      if (saved === undefined) throw new Error('A successful draft save must return the saved draft.')
      draftRecords.set(saved.id, saved)
      promote()
      await enqueue(() => drafts.put(saved.id, saved)).catch(reportError)
      return { kind: 'applied', revision, drafts: draftsSnapshot().drafts }
    },
    removeDraft: async id => {
      const current = orderDrafts(draftRecords.values())
      if (removeDraftEntry(draftStoreOf(current), id).drafts.length !== current.length) {
        draftRecords.delete(id)
        promote()
        await enqueue(() => drafts.delete(id)).catch(reportError)
      }
      return draftsSnapshot()
    },
    flush: () => writes,
  }
}
