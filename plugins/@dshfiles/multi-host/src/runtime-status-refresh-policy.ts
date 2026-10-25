export const runtimeStatusRefreshRefetchInterval = (input: { readonly intervalMs: number | false; readonly refreshing: boolean }): number | false => {
  if (input.intervalMs === false) return false
  return input.refreshing ? 5_000 : input.intervalMs
}
