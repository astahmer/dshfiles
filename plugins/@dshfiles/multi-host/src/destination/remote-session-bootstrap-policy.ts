export const shouldBootstrapRemoteSession = (input: {
  readonly currentSessionId: string | undefined
  readonly ownerKnown: boolean
  readonly ownerRuntimeId: string | null | undefined
  readonly destinationRuntimeId: string
}): boolean => {
  if (input.currentSessionId === undefined) return true
  return input.ownerKnown && input.ownerRuntimeId !== input.destinationRuntimeId
}
