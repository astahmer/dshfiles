export const workspaceHasOtherSession = (input: { readonly sessionId: string; readonly workspaceSessionIds: readonly string[] | undefined }): boolean =>
  input.workspaceSessionIds === undefined ||
  !input.workspaceSessionIds.includes(input.sessionId) ||
  input.workspaceSessionIds.some(sessionId => sessionId !== input.sessionId)
