import type { SessionSourceRegistry } from '@dshfiles/session-source-port'
import { Effect } from 'effect'
import { authorizeRemoteSessionRuntime } from './session-runtime-authorization.js'
import { knownSessionRuntime } from './session-runtime.js'

/**
 * The Cordis `sessionSources` registry is a Promise contract owned by the Session controller, so this is the plugin's
 * only edge onto it: two thin Effect wrappers, no policy of their own.
 */
export const knownRuntimeOf = (input: { readonly sessionId: string; readonly registries: readonly SessionSourceRegistry[] }) =>
  Effect.promise(() => knownSessionRuntime({ sessionId: input.sessionId, sessionSources: input.registries }))

export const authorizeVia = (input: {
  readonly sessionId: string
  readonly runtimeId: string
  readonly recordedSessions: readonly { readonly sessionId: string; readonly runtimeId: string }[]
  readonly registries: readonly SessionSourceRegistry[]
}) =>
  Effect.promise(() =>
    authorizeRemoteSessionRuntime({
      sessionId: input.sessionId,
      runtimeId: input.runtimeId,
      recordedSessions: input.recordedSessions,
      sessionSources: input.registries,
    }),
  )
