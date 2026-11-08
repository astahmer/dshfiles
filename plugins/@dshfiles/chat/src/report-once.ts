/** Logs one failure per key, so a provider that fails on every render reports once instead of flooding the console. */
export type ReportOnce = (key: string, message: string, error: unknown) => void

/**
 * A reporter whose `console.error` lines start with `prefix`; each reporter remembers its own keys.
 * @param prefix - who reports, e.g. `@dshfiles/chat code fences`.
 */
export const createReportOnce = (prefix: string): ReportOnce => {
  const reported = new Set<string>()
  return (key, message, error) => {
    if (reported.has(key)) return
    reported.add(key)
    console.error(`${prefix}: ${message}`, error)
  }
}
