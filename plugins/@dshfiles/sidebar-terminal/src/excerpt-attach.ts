/** Attach a terminal selection to the thread that owns the terminal, through the composer contract. */
import { Composer, type ComposerService, type Live, type Subscribable } from '@dshfiles/dshx/client'
import type { TerminalExcerpt } from './native/client/excerpt.ts'

/** The part of a plugin context an excerpt needs: the composer contract's live provider. */
export interface ComposerSource {
  use(contract: typeof Composer): Subscribable<Live<ComposerService>>
}

/**
 * Attach one terminal selection as a chip in its own thread's draft.
 * @param input - the plugin context, the terminal's session and its excerpt.
 * @returns false when that thread's composer cannot take it, so the terminal keeps
 * the selection and points at the originating thread.
 */
export const attachTerminalExcerpt = (input: {
  readonly composer: ComposerSource | undefined
  readonly sessionId: string
  readonly excerpt: TerminalExcerpt
}): boolean => {
  const live = input.composer?.use(Composer).get()
  if (live?.status !== 'active') return false
  return live.value.attach({
    sessionId: input.sessionId,
    attachment: { kind: 'terminal-excerpt', text: input.excerpt.text, label: input.excerpt.label },
  })
}
