import { DshxPlugin } from '@dshfiles/dshx/effect'
import { agentSessionsApi } from './api.js'

// Nothing has to run before the panel does: it reads local agent logs on demand and its only loop is demand-gated, so a
// Host nobody opens the panel in loads only the contract, not the parsers, the index or `@effect/platform-node`.
export default DshxPlugin.facade({
  name: '@dshfiles/agentsview',
  apis: [agentSessionsApi],
  load: () => import('./host-implementation.js'),
})
