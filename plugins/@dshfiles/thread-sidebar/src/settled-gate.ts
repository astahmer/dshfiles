/** The durable header fields the settled-lineage walk reads. */
export interface SettledSessionHeader {
  readonly id: string
  readonly origin?: 'subagent' | undefined
  readonly parentSession?: string | undefined
}

/**
 * Whether a Session, or a Session above it in its subagent lineage, is settled. Lineage follows the
 * durable header fields through subagent-origin Sessions only: a fork of a settled Session is an
 * independent conversation, exactly as it is for the native archived-set gate. A missing parent
 * header still answers from the recorded parent id, so a pruned ancestor keeps its child settled.
 */
export const underSettledSession = (input: {
  readonly header: SettledSessionHeader
  readonly settledSessionIds: readonly string[]
  readonly parentHeader: (sessionId: string) => SettledSessionHeader | undefined
}): boolean => {
  const settled = new Set(input.settledSessionIds)
  let header = input.header
  const visited = new Set<string>()
  while (!visited.has(header.id)) {
    if (settled.has(header.id)) return true
    visited.add(header.id)
    if (header.origin !== 'subagent' || header.parentSession === undefined) return false
    const parent = input.parentHeader(header.parentSession)
    if (parent === undefined) return settled.has(header.parentSession)
    header = parent
  }
  return false
}
