import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { multiHostApi } from '@dshfiles/multi-host/api'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { jujutsuApi } from './api.js'
import { composerContextApi } from './composer-context-api.js'
import { OwnerRouting, type OwnerPort } from './owner-routed-api.js'

const PanelSession = createContext<SessionId | null>(null)

/** The thread this panel belongs to; a panel with none reads this Host's repositories. */
export const JujutsuPanelSession = (props: { readonly sessionId: SessionId | null; readonly children: ReactNode }): JSX.Element => (
  <PanelSession.Provider value={props.sessionId}>{props.children}</PanelSession.Provider>
)

const useOwnerPort = (): OwnerPort => {
  const multiHost = useApi(multiHostApi)
  // SAFETY: the two shapes differ only in that the port leaves `method` to the Host, which validates it.
  return multiHost as never as OwnerPort
}

/** The jujutsu API of the panel's thread, on whichever Host owns it. */
export const useJujutsuApi = () => {
  const local = useApi(jujutsuApi)
  const owner = useOwnerPort()
  const sessionId = useContext(PanelSession)
  return useMemo(
    () => (sessionId === null ? local : OwnerRouting.api({ local, api: 'jujutsu', methods: jujutsuApi.methods, owner, sessionId })),
    [local, owner, sessionId],
  )
}

/** The composer context API of one thread, on whichever Host owns it. */
export const useComposerContextApi = (sessionId: SessionId | undefined) => {
  const local = useApi(composerContextApi)
  const owner = useOwnerPort()
  return useMemo(
    () => (sessionId === undefined ? local : OwnerRouting.api({ local, api: 'jujutsu-composer', methods: composerContextApi.methods, owner, sessionId })),
    [local, owner, sessionId],
  )
}
