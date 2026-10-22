import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MirroredSessionSource, SessionSourceRegistry } from '@dshfiles/session-source-port'

export type RemoteSessionAuthorization =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'session/not-remote' | 'session/wrong-runtime'; readonly message: string }

export const authorizeRemoteSessionRuntime = async ({
  sessionId,
  runtimeId,
  recordedSessions,
  sessionSources,
}: {
  readonly sessionId: string
  readonly runtimeId: string
  readonly recordedSessions: readonly { readonly sessionId: string; readonly runtimeId: string }[]
  readonly sessionSources: SessionSourceRegistry | readonly SessionSourceRegistry[] | undefined
}): Promise<RemoteSessionAuthorization> => {
  const recorded = recordedSessions.find(thread => thread.sessionId === sessionId)
  const sources: MirroredSessionSource[] = []
  const registries: readonly SessionSourceRegistry[] = sessionSources === undefined ? [] : Array.isArray(sessionSources) ? sessionSources : [sessionSources]
  if (recorded === undefined) {
    for (const registry of [...registries].reverse()) {
      try {
        const source = registry.ownerOf(SessionId(sessionId)) ?? (await registry.resolveOwner(SessionId(sessionId)))
        if (source !== undefined) sources.push(source)
      } catch {
        continue
      }
    }
  }
  let owningRuntimeId = recorded?.runtimeId
  for (const source of sources) {
    if (source.runtimeIdForSession === undefined) continue
    try {
      owningRuntimeId = await source.runtimeIdForSession(sessionId)
      if (owningRuntimeId !== undefined) break
    } catch {
      continue
    }
  }
  if (owningRuntimeId === undefined) {
    return { ok: false, code: 'session/not-remote', message: 'This Session is not owned by a remote runtime.' }
  }
  if (owningRuntimeId !== runtimeId) {
    return { ok: false, code: 'session/wrong-runtime', message: 'The selected Host does not own this Session.' }
  }
  return { ok: true }
}
