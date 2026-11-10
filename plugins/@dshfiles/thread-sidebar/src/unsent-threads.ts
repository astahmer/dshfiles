import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionDraft } from '@dshfiles/session-controller/draft-client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Draft visibility never changes the Host's `blank` bit (the composer still needs its New chat hero). */
export const isListedUnsentThread = (input: {
  readonly session: Pick<SessionSummary, 'id' | 'blank'>
  readonly selectedSessionId: string | undefined
  readonly draft: Pick<SessionDraft, 'preview'> | undefined
}): boolean => !input.session.blank || input.session.id === input.selectedSessionId || (input.draft?.preview.trim() ?? '') !== ''

/**
 * Present the draft label on blank rows only, derived from preview metadata (never used to restore editor text). Every other row keeps its identity, the record itself is returned when no
 * row is blank, and `presented` keeps a blank row's labelled object while its source row and label are unchanged, so a
 * list publish does not rebuild every row.
 */
export const presentUnsentRows = (input: {
  readonly byId: Readonly<Record<SessionId, SessionSummary>>
  readonly drafts: Readonly<Record<string, Pick<SessionDraft, 'preview'>>>
  readonly newChatLabel: string
  readonly draftLabel: (preview: string) => string
  readonly presented: WeakMap<SessionSummary, SessionSummary>
}): Readonly<Record<SessionId, SessionSummary>> => {
  let overlaid: Record<SessionId, SessionSummary> | undefined
  for (const key in input.byId) {
    // SAFETY: the keys of a record typed by SessionId are exactly that record's session ids.
    const id = key as SessionId
    const session = input.byId[id]
    if (session === undefined || !session.blank) continue
    const preview = input.drafts[id]?.preview.trim() ?? ''
    const displayTitle = preview === '' ? input.newChatLabel : input.draftLabel(preview)
    const cached = input.presented.get(session)
    const row = cached?.displayTitle === displayTitle ? cached : { ...session, displayTitle }
    input.presented.set(session, row)
    overlaid ??= { ...input.byId }
    overlaid[id] = row
  }
  return overlaid ?? input.byId
}
