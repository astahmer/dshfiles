import { z } from 'zod'

/** Drafts once shared the prompt library's key, so each save overwrote the library; they now have their own. */
export const DRAFT_STORE_KEY = 'dshfiles.prompt-stash.drafts.v1'
export const LEGACY_DRAFT_STORE_KEY = 'dshfiles.prompt-stash.v1'

export const MAX_SAVED_DRAFTS = 20
export const MAX_DRAFT_TEXT_CHARS = 24_000
export const MAX_DRAFT_TITLE_CHARS = 120
export const MAX_DRAFT_STORE_BYTES = 512_000
export const MAX_SENT_PROMPTS = 50
export const MAX_SENT_PROMPT_TEXT_CHARS = 24_000

const sentPromptBlockSchema = z
  .object({
    type: z.string().min(1).max(80),
    text: z.string().max(MAX_SENT_PROMPT_TEXT_CHARS).optional(),
  })
  .passthrough()

const sentPromptNodeSchema = z
  .object({
    kind: z.literal('user'),
    seq: z.number().int().min(0),
    content: z.array(sentPromptBlockSchema).max(256),
  })
  .passthrough()

const savedDraftSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(MAX_DRAFT_TITLE_CHARS),
    text: z.string().min(1).max(MAX_DRAFT_TEXT_CHARS),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()

const draftStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    drafts: z.array(savedDraftSchema).max(MAX_SAVED_DRAFTS),
  })
  .strict()
  .superRefine((store, context) => {
    if (new Set(store.drafts.map(draft => draft.id)).size !== store.drafts.length) {
      context.addIssue({ code: 'custom', message: 'Saved draft ids must be unique.' })
    }
  })

export type SavedDraft = z.infer<typeof savedDraftSchema>
export type DraftStore = z.infer<typeof draftStoreSchema>

export interface SentPrompt {
  readonly id: number
  readonly text: string
}

export type DraftSaveBlock = 'busy' | 'empty' | 'rich-content' | 'too-long'

export type SaveDraftResult =
  | { readonly ok: true; readonly store: DraftStore; readonly serialized: string }
  | { readonly ok: false; readonly reason: 'duplicate-id' | 'limit' | 'too-large' | 'invalid-title' }

const emptyDraftStore = (): DraftStore => ({ schemaVersion: 1, drafts: [] })

export const draftSaveBlock = (input: {
  readonly phase: string
  readonly text: string
  readonly attachmentCount: number
  readonly referenceCount: number
}): DraftSaveBlock | null => {
  if (input.phase !== 'plain') return 'busy'
  if (input.text.trim().length === 0) return 'empty'
  if (input.attachmentCount > 0 || input.referenceCount > 0) return 'rich-content'
  if (input.text.length > MAX_DRAFT_TEXT_CHARS) return 'too-long'
  return null
}

export const readDraftStore = (source: string | null): DraftStore => {
  if (source === null || new TextEncoder().encode(source).byteLength > MAX_DRAFT_STORE_BYTES) return emptyDraftStore()
  try {
    const decoded: unknown = JSON.parse(source)
    const result = draftStoreSchema.safeParse(decoded)
    return result.success ? result.data : emptyDraftStore()
  } catch {
    return emptyDraftStore()
  }
}

/**
 * Reads the drafts key. Drafts left under the key they once shared with the prompt library move to their own key
 * on first read, so a later library save cannot overwrite them.
 */
export const readStoredDrafts = (storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }): DraftStore => {
  const current = storage.getItem(DRAFT_STORE_KEY)
  if (current !== null) return readDraftStore(current)
  const legacy = readDraftStore(storage.getItem(LEGACY_DRAFT_STORE_KEY))
  if (legacy.drafts.length > 0) storage.setItem(DRAFT_STORE_KEY, JSON.stringify(legacy))
  return legacy
}

export const defaultDraftTitle = (text: string): string => {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const title = firstLine.length === 0 ? 'Saved draft' : firstLine
  return title.length > MAX_DRAFT_TITLE_CHARS ? `${title.slice(0, MAX_DRAFT_TITLE_CHARS - 1)}…` : title
}

export const saveDraft = (
  current: DraftStore,
  draft: { readonly id: string; readonly title: string; readonly text: string; readonly now: string },
): SaveDraftResult => {
  if (current.drafts.length >= MAX_SAVED_DRAFTS) return { ok: false, reason: 'limit' }
  if (current.drafts.some(saved => saved.id === draft.id)) return { ok: false, reason: 'duplicate-id' }
  const title = draft.title.trim()
  if (title.length === 0 || title.length > MAX_DRAFT_TITLE_CHARS) return { ok: false, reason: 'invalid-title' }
  if (draft.text.trim().length === 0 || draft.text.length > MAX_DRAFT_TEXT_CHARS) return { ok: false, reason: 'too-large' }

  const store = draftStoreSchema.parse({
    schemaVersion: 1,
    drafts: [{ id: draft.id, title, text: draft.text, createdAt: draft.now, updatedAt: draft.now }, ...current.drafts],
  })
  const serialized = JSON.stringify(store)
  if (new TextEncoder().encode(serialized).byteLength > MAX_DRAFT_STORE_BYTES) return { ok: false, reason: 'too-large' }
  return { ok: true, store, serialized }
}

export const removeDraft = (current: DraftStore, draftId: string): DraftStore =>
  draftStoreSchema.parse({
    schemaVersion: 1,
    drafts: current.drafts.filter(draft => draft.id !== draftId),
  })

export const sentPromptFromNode = (source: unknown): SentPrompt | null => {
  const result = sentPromptNodeSchema.safeParse(source)
  if (!result.success || result.data.content.length === 0) return null
  if (result.data.content.some(block => block.type !== 'text' || block.text === undefined)) return null
  const text = result.data.content.map(block => block.text ?? '').join('')
  if (text.trim().length === 0 || text.length > MAX_SENT_PROMPT_TEXT_CHARS) return null
  return { id: result.data.seq, text }
}
