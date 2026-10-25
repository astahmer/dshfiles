export const runtimeStatusRefreshRefetchInterval = (input: {
  readonly intervalMs: number | false
  readonly refreshing: boolean
  readonly available: boolean | undefined
}): number | false => {
  if (input.intervalMs === false) return false
  if (input.available === false) return Math.max(input.intervalMs, 60_000)
  return input.refreshing ? 5_000 : input.intervalMs
}

export const runtimePingRefetchInterval = (input: { readonly menuOpen: boolean; readonly available: boolean | undefined }): number =>
  input.available === false ? 60_000 : input.menuOpen ? 10_000 : 60_000
