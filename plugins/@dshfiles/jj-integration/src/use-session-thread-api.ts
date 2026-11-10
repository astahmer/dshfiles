import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { multiHostApi } from '@dshfiles/multi-host/api'
import { useMemo } from 'react'
import { jjIntegrationApi } from './api.js'
import { sessionThreadApi } from './session-thread-api.js'

/** The JJ thread actions of one Session, on the Host that owns it. */
export const useSessionThreadApi = (sessionId: SessionId): ReturnType<typeof sessionThreadApi> => {
  const local = useApi(jjIntegrationApi)
  const remote = useApi(multiHostApi)
  return useMemo(() => sessionThreadApi({ local, remote, sessionId }), [local, remote, sessionId])
}
