import { z } from 'zod'

export const PROMPT_LIBRARY_STORAGE_KEY = 'dshfiles.prompt-stash.v1'
export const PROMPT_LIBRARY_LOCAL_STORAGE_KEY = 'dshfiles.prompt-stash.library-local.v2'
export const MAX_PROMPTS = 50
export const MAX_PROMPT_TITLE_LENGTH = 100
export const MAX_PROMPT_TEXT_LENGTH = 20_000
const MAX_LIBRARY_CHARACTERS = 450_000

export const promptSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.string().uuid(),
    title: z.string().trim().min(1).max(MAX_PROMPT_TITLE_LENGTH),
    text: z.string().min(1).max(MAX_PROMPT_TEXT_LENGTH),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()

const librarySchema = z
  .object({
    version: z.literal(1),
    prompts: z.array(promptSchema).max(MAX_PROMPTS),
  })
  .strict()
  .superRefine((library, context) => {
    const ids = new Set(library.prompts.map(prompt => prompt.id))
    if (ids.size !== library.prompts.length) {
      context.addIssue({ code: 'custom', path: ['prompts'], message: 'Prompt ids must be unique.' })
    }

    const totalCharacters = library.prompts.reduce((total, prompt) => total + prompt.title.length + prompt.text.length, 0)
    if (totalCharacters > MAX_LIBRARY_CHARACTERS) {
      context.addIssue({ code: 'custom', path: ['prompts'], message: 'The saved prompt library is too large.' })
    }
  })

/** Drafts once wrote this key too; that payload holds no prompts and must not lock the library as unreadable. */
const legacyDraftsSchema = z.object({ schemaVersion: z.literal(1), drafts: z.array(z.unknown()) })

export type SavedPrompt = z.infer<typeof promptSchema>
export type PromptLibraryStore = z.infer<typeof librarySchema>
export type PromptLibraryStoredRead =
  | { readonly kind: 'missing'; readonly store: PromptLibraryStore }
  | { readonly kind: 'library'; readonly store: PromptLibraryStore }
  | { readonly kind: 'legacy-drafts'; readonly store: PromptLibraryStore }
  | { readonly kind: 'invalid' }

const emptyPromptLibraryStore = (): PromptLibraryStore => ({ version: 1, prompts: [] })

const defaultPromptTitle = (text: string): string => {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const title = firstLine.length === 0 ? 'Saved prompt' : firstLine
  return title.length > MAX_PROMPT_TITLE_LENGTH ? `${title.slice(0, MAX_PROMPT_TITLE_LENGTH - 1)}…` : title
}

export type PromptLibraryRead = { readonly ok: true; readonly prompts: readonly SavedPrompt[] } | { readonly ok: false }

export type PromptMutation =
  | { readonly kind: 'applied'; readonly prompts: readonly SavedPrompt[] }
  | { readonly kind: 'conflict'; readonly prompts: readonly SavedPrompt[] }

const readPromptLibraryWithSource = (serialized: string | null): PromptLibraryStoredRead => {
  if (serialized === null) return { kind: 'missing', store: emptyPromptLibraryStore() }

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { kind: 'invalid' }
  }

  const parsed = librarySchema.safeParse(value)
  if (parsed.success) return { kind: 'library', store: parsed.data }
  if (legacyDraftsSchema.safeParse(value).success) return { kind: 'legacy-drafts', store: emptyPromptLibraryStore() }
  return { kind: 'invalid' }
}

const readPromptLibrary = (serialized: string | null): PromptLibraryRead => {
  const result = readPromptLibraryWithSource(serialized)
  return result.kind === 'invalid' ? { ok: false } : { ok: true, prompts: result.store.prompts }
}

const clearStoredPromptLibrary = (input: {
  readonly storage: Pick<Storage, 'getItem' | 'removeItem'>
  readonly key: string
  readonly serialized: string | null
  readonly storeFingerprint: string | null
  readonly expectedStore: PromptLibraryStore
}): boolean => {
  if (input.serialized === null || input.storeFingerprint !== JSON.stringify(input.expectedStore) || input.storage.getItem(input.key) !== input.serialized) {
    return false
  }
  input.storage.removeItem(input.key)
  return true
}

const serializePromptLibrary = (prompts: readonly SavedPrompt[]): string | null => {
  const parsed = librarySchema.safeParse({ version: 1, prompts })
  if (!parsed.success) return null
  return JSON.stringify(parsed.data)
}

const writePromptIfCurrent = (prompts: readonly SavedPrompt[], next: SavedPrompt, expectedRevision: string | null): PromptMutation => {
  const current = prompts.find(prompt => prompt.id === next.id)
  if (expectedRevision === null ? current !== undefined : current?.revision !== expectedRevision) {
    return { kind: 'conflict', prompts }
  }

  return {
    kind: 'applied',
    prompts: [next, ...prompts.filter(prompt => prompt.id !== next.id)],
  }
}

const removePromptIfCurrent = (prompts: readonly SavedPrompt[], id: string, expectedRevision: string): PromptMutation => {
  const current = prompts.find(prompt => prompt.id === id)
  if (current === undefined || current.revision !== expectedRevision) return { kind: 'conflict', prompts }

  return {
    kind: 'applied',
    prompts: prompts.filter(prompt => prompt.id !== id),
  }
}

export class PromptLibrary {
  static readonly schema = librarySchema
  static readonly emptyStore = emptyPromptLibraryStore
  static readonly maxPrompts = MAX_PROMPTS
  static readonly maxPromptTitleLength = MAX_PROMPT_TITLE_LENGTH
  static readonly maxPromptTextLength = MAX_PROMPT_TEXT_LENGTH
  static readonly defaultTitle = defaultPromptTitle
  static readonly read = readPromptLibrary
  static readonly readStoredWithSource = readPromptLibraryWithSource
  static readonly clearStoredIfUnchanged = clearStoredPromptLibrary
  static readonly serialize = serializePromptLibrary
  static readonly writeIfCurrent = writePromptIfCurrent
  static readonly removeIfCurrent = removePromptIfCurrent
}
