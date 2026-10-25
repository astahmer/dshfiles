export const usageLimitRefetchInterval = (input: {
  readonly primarySurface: boolean
  readonly ownerMissing: boolean
  readonly errored: boolean
}): number | false => {
  if (!input.primarySurface || input.ownerMissing || input.errored) return false
  return 15_000
}
