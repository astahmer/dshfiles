import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionDraft } from '@dshfiles/session-controller/draft-client'

/** Draft visibility never changes the Host's `blank` bit (the composer still needs its New chat hero). */
export const isListedUnsentThread = (input: {
  readonly session: Pick<SessionSummary, 'id' | 'blank'>
  readonly selectedSessionId: string | undefined
  readonly draft: Pick<SessionDraft, 'preview'> | undefined
}): boolean => !input.session.blank || input.session.id === input.selectedSessionId || (input.draft?.preview.trim() ?? '') !== ''

/** Derive a recognizable row label from preview metadata, never use it to restore editor text. */
export const presentUnsentThread = (input: {
  readonly session: SessionSummary
  readonly draft: Pick<SessionDraft, 'preview'> | undefined
  readonly newChatLabel: string
  readonly draftLabel: (preview: string) => string
}): SessionSummary => {
  if (!input.session.blank) return input.session
  const preview = input.draft?.preview.trim() ?? ''
  return { ...input.session, displayTitle: preview === '' ? input.newChatLabel : input.draftLabel(preview) }
}
