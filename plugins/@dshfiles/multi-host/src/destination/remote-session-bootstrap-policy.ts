/** What the main view shows right now: no Session, a listed Session, or one the Session list has not caught up with. */
export type ShownSession =
  | { readonly kind: 'none' }
  | { readonly kind: 'session'; readonly sessionId: string; readonly blank: boolean }
  | { readonly kind: 'unlisted' }

export const shouldBootstrapRemoteSession = (input: {
  readonly shown: ShownSession
  readonly ownerKnown: boolean
  readonly ownerRuntimeId: string | null | undefined
  readonly destinationRuntimeId: string
}): boolean => {
  if (input.shown.kind === 'none') return true
  // A thread with turns, or one not listed yet, is not a New thread screen: a picker still rendered while the main view
  // leaves it (a tab switch) must not open a remote thread and pull the view back.
  if (input.shown.kind === 'unlisted' || !input.shown.blank) return false
  return input.ownerKnown && input.ownerRuntimeId !== input.destinationRuntimeId
}
