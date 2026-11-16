import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { multiHostApi } from '@dshfiles/multi-host/api'
import { readSessionRuntime } from '@dshfiles/multi-host/session-runtime-read'
import { useMemo } from 'react'
import { jjIntegrationApi } from './api.js'
import { sessionThreadApi, type SessionThreadRemote } from './session-thread-api.js'

/** The JJ thread actions of one Session, on the Host that owns it. */
export const useSessionThreadApi = (sessionId: SessionId): ReturnType<typeof sessionThreadApi> => {
  const local = useApi(jjIntegrationApi)
  const multiHost = useApi(multiHostApi)
  return useMemo(() => {
    // Each thread view mounts this control, so the owner read is the one the page already shares for this Session.
    const remote: SessionThreadRemote = {
      sessionRuntime: (input, options) => readSessionRuntime({ client: multiHost, sessionId: input.sessionId, signal: options?.signal }),
      sessionJjCall: multiHost.sessionJjCall,
    }
    return sessionThreadApi({ local, remote, sessionId })
  }, [local, multiHost, sessionId])
}
