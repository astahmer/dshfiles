import { z } from 'zod'

/**
 * ArrowUp prompt recall over the thread's own prompts, read from the Session event window the conversation already
 * holds: no second history is stored.
 *
 * Recall starts only from an empty draft. While a recalled prompt is still unedited, ArrowUp on its first line goes
 * older, ArrowDown on its last line goes newer and past the newest restores the draft recall started from, and Escape
 * restores that draft at once. Editing the recalled text ends recall, so the arrows move the caret again.
 */

const userPromptEventSchema = z.object({
  type: z.literal('event'),
  event: z.object({
    type: z.literal('user/message'),
    data: z.object({
      source: z.object({ kind: z.literal('user') }),
      content: z.array(z.unknown()),
    }),
  }),
})

const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() })

const promptTextOf = (content: readonly unknown[]): string =>
  content
    .flatMap(block => {
      const text = textBlockSchema.safeParse(block)
      return text.success ? [text.data.text] : []
    })
    .join('')

/** The human prompts of an event window, newest first, each text once. */
const promptsOf = (entries: readonly unknown[]): readonly string[] => {
  const seen = new Set<string>()
  const prompts: string[] = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = userPromptEventSchema.safeParse(entries[index])
    if (!entry.success) continue
    const text = promptTextOf(entry.data.event.data.content)
    if (text.trim() === '' || seen.has(text)) continue
    seen.add(text)
    prompts.push(text)
  }
  return prompts
}

export type RecallDirection = 'older' | 'newer'

interface RecallInput {
  readonly direction: RecallDirection
  readonly draft: string
  readonly caret: { readonly start: number; readonly end: number }
  readonly prompts: () => readonly string[]
}

interface RecallState {
  readonly index: number
  readonly savedDraft: string
  readonly shown: string
}

/** One composer's recall position; `null` from a step means the key keeps its ordinary behaviour. */
export interface PromptRecall {
  readonly step: (input: RecallInput) => string | null
  readonly escape: (draft: string) => string | null
}

const onFirstLine = (draft: string, caret: RecallInput['caret']): boolean => !draft.slice(0, caret.start).includes('\n')
const onLastLine = (draft: string, caret: RecallInput['caret']): boolean => !draft.slice(caret.end).includes('\n')

const create = (): PromptRecall => {
  let state: RecallState | null = null

  const unedited = (draft: string): RecallState | null => {
    if (state !== null && state.shown !== draft) state = null
    return state
  }

  const show = (next: RecallState): string => {
    state = next
    return next.shown
  }

  const step = (input: RecallInput): string | null => {
    const current = unedited(input.draft)
    if (current === null) {
      if (input.direction === 'newer' || input.draft.trim() !== '') return null
      const newest = input.prompts()[0]
      return newest === undefined ? null : show({ index: 0, savedDraft: input.draft, shown: newest })
    }
    if (input.direction === 'older') {
      if (!onFirstLine(input.draft, input.caret)) return null
      const older = input.prompts()[current.index + 1]
      return older === undefined ? null : show({ ...current, index: current.index + 1, shown: older })
    }
    if (!onLastLine(input.draft, input.caret)) return null
    if (current.index === 0) {
      state = null
      return current.savedDraft
    }
    const newer = input.prompts()[current.index - 1]
    if (newer === undefined) return null
    return show({ ...current, index: current.index - 1, shown: newer })
  }

  const escape = (draft: string): string | null => {
    const current = unedited(draft)
    if (current === null) return null
    state = null
    return current.savedDraft
  }

  return { step, escape }
}

export class PromptRecallModel {
  static readonly promptsOf = promptsOf
  static readonly create = create
}
