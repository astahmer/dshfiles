import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { capabilitiesHubApi } from './api.js'
import { CapabilitiesHub, type HubOverview } from './hub-model.js'

/** The static launchpad this Host serves; each owner keeps its own state, installs and credentials. */
class Launchpad extends Context.Service<Launchpad, { readonly overview: Effect.Effect<HubOverview> }>()('@dshfiles/capabilities-hub/Launchpad') {
  static readonly layer = Layer.succeed(Launchpad, Launchpad.of({ overview: Effect.sync(() => CapabilitiesHub.overview()) }))
}

/** The Host half only serves the static launchpad to Agents. */
export default DshxPlugin.make({
  name: 'dshfiles-capabilities-hub',
  layer: Launchpad.layer,
  apis: [Api.bind(capabilitiesHubApi, { overview: () => Launchpad.use(launchpad => launchpad.overview) })],
})
