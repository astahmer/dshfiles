import { createContext, useContext, type ReactNode } from 'react'

import type { AgentDispatchPort } from './agent-dispatch.js'

const AgentDispatchContext = createContext<AgentDispatchPort | null>(null)

/**
 * Carries the agent dispatch port down to any comment box in the panel without threading it through every list view;
 * absent means the agents bundle is not installed, so a mention stays a plain comment.
 */
export const AgentDispatchProvider = (props: { readonly port: AgentDispatchPort | null; readonly children: ReactNode }): JSX.Element => (
  <AgentDispatchContext.Provider value={props.port}>{props.children}</AgentDispatchContext.Provider>
)

export const useAgentDispatch = (): AgentDispatchPort | null => useContext(AgentDispatchContext)
