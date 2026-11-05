import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect, Layer } from 'effect'
import { capabilitiesHubApi } from './api.js'
import { CapabilitiesHub } from './hub-model.js'

/** The Host half only serves the static launchpad to Agents; each owner keeps its own state, installs and credentials. */
export default DshxPlugin.make({
  name: 'dshfiles-capabilities-hub',
  layer: Layer.empty,
  apis: [Api.bind(capabilitiesHubApi, { overview: () => Effect.succeed(CapabilitiesHub.overview()) })],
})
