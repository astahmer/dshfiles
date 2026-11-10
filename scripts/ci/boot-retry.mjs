/**
 * On a 4 vCPU runner a Client entry occasionally stays `pending` past the 45 s settle window although the same owner
 * boots in seconds locally and on a rerun. Retry once on CI: Turbo replays every owner that passed, so only the failed
 * ones boot again, and an owner that fails twice still fails the shard. Outside CI a failure is reported at once.
 */
export const bootWithRetry = async ({ boot, ci, log }) => {
  const first = await boot()
  if (first === 0 || !ci) return first
  log('retrying the owners that failed once')
  return boot()
}
