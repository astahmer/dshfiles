const WARNING_HEADER = /^dsh: warning: \d+ entr(?:y|ies) did not activate$/
const ENTRY = /^(\S+) \([^)]*\): (\w+)/

/**
 * DSH prints which Loader entries were still pending when its boot settled. A service a bundle registers after an
 * asynchronous start (the owned session search) leaves its dependents in that list although they activate a moment
 * later, so the warning is only a failure while an entry it names is still not active.
 */
const lateActivation = (input: {
  readonly hostLog: string
  readonly activeIds: ReadonlySet<string>
}): { readonly header: string; readonly entries: readonly string[] } | undefined => {
  const lines = input.hostLog.split('\n')
  const headerIndex = lines.findIndex(line => WARNING_HEADER.test(line.trim()))
  if (headerIndex === -1) return undefined
  const header = lines[headerIndex]?.trim() ?? ''
  const block = lines.slice(headerIndex + 1).map(line => line.trim())
  const end = block.findIndex(line => !ENTRY.test(line))
  const listed = (end === -1 ? block : block.slice(0, end)).map(line => ENTRY.exec(line))
  const entries = listed.flatMap(match => (match?.[1] !== undefined && match[2] === 'pending' ? [match[1]] : []))
  if (entries.length === 0 || entries.length !== listed.length) return undefined
  return entries.every(id => input.activeIds.has(id)) ? { header, entries } : undefined
}

export class BootWarning {
  static readonly lateActivation = lateActivation
}
