/**
 * The workspace a Session's composer writes into. A sent Session is listed under its workspace; dshfiles'
 * session-controller keeps a blank New thread as a draft that only its draft list places, so the draft list answers
 * when the workspace list does not. The send guard reads this: without the draft answer a blank thread had no
 * workspace, its send was never held while a switch ran, and it went through in the checkout the user was leaving.
 */
export const sessionWorkspaceId = (input: {
  readonly sessionId: string
  readonly workspaces: readonly { readonly workspaceId: string; readonly sessionIds: readonly string[] }[]
  readonly drafts: Readonly<Record<string, { readonly workspaceId?: string } | undefined>> | undefined
}): string | undefined => input.workspaces.find(item => item.sessionIds.includes(input.sessionId))?.workspaceId ?? input.drafts?.[input.sessionId]?.workspaceId
