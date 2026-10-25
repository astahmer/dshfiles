import type { SessionSourceRegistry } from '@dshfiles/session-source-port'

/** Return a runtime only when the Session source registry already knows its owner. */
export const knownSessionRuntime = async (input: {
  readonly sessionId: string
  readonly sessionSources: readonly Pick<SessionSourceRegistry, 'ownerOf'>[]
}): Promise<string | null> => {
  for (const registry of [...input.sessionSources].reverse()) {
    const source = registry.ownerOf(input.sessionId)
    if (source === undefined) continue
    if (source.runtimeIdForSession === undefined) return null
    return (await source.runtimeIdForSession(input.sessionId)) ?? null
  }
  return null
}
