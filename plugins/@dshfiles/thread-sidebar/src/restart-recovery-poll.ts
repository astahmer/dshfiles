export const restartRecoveryRefetchInterval = (input: {
  readonly primarySurface: boolean
  readonly ownerMissing: boolean
  readonly hasData: boolean
  readonly hasPending: boolean
}): number | false => {
  if (!input.primarySurface || input.ownerMissing) return false
  if (input.hasData && !input.hasPending) return false
  return 30_000
}
