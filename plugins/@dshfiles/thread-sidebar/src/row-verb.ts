/**
 * What a thread row's inline verb does, decided apart from the list so each rule has a test. Answer and Approve open
 * the thread, where the question or approval card is answered in place; Retry and Resume on an inbox item run that
 * item's provider verb through the inbox, exactly as the Inbox page does; a Resume the sidebar itself classified
 * (interrupted turn) resumes it here.
 *
 * Land moves the thread's work onto the bookmark, so it is never one click: it opens the thread header's confirmation
 * (jj-integration's `ThreadHeaderLand.confirm`), which lists the revisions and lands only on its confirm. Without
 * that contract nothing here can confirm, so the row opens the thread instead of landing.
 */
import type { InlineVerb, ThreadStatus } from './thread-status.js'

export type RowVerbAction =
  | { readonly kind: 'open' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'confirm-land' }
  | { readonly kind: 'act'; readonly itemId: string; readonly verb: Exclude<InlineVerb, 'Answer' | 'Approve' | 'Land'> }

const actionOf = (
  status: Pick<ThreadStatus, 'verb' | 'itemId'>,
  context: { readonly recovering: boolean; readonly landConfirm: boolean },
): RowVerbAction => {
  const verb = status.verb
  if (verb === undefined || verb === 'Answer' || verb === 'Approve') return { kind: 'open' }
  if (verb === 'Land') return context.landConfirm ? { kind: 'confirm-land' } : { kind: 'open' }
  if (status.itemId === undefined) return verb === 'Resume' && context.recovering ? { kind: 'resume' } : { kind: 'open' }
  return { kind: 'act', itemId: status.itemId, verb }
}

export class RowVerb {
  static readonly actionOf = actionOf
}
