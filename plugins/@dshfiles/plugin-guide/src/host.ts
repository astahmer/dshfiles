import { createRequire } from 'node:module'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option } from 'effect'
import * as Schema from 'effect/Schema'
import { pluginGuideApi } from './api.js'
import { PluginGuide, type GuideFreshness } from './catalog-model.js'
import { GUIDE_CATALOG } from './generated/guide-catalog.js'

/** The DSH core this Host resolves, read once from its package manifest; null when it cannot be found. */
const decodeManifest = Schema.decodeUnknownOption(Schema.Struct({ version: Schema.String }))
const runtimeDshVersion = (): string | null => {
  try {
    return Option.getOrNull(Option.map(decodeManifest(createRequire(import.meta.url)('@deepseek-ai/dsh/package.json')), manifest => manifest.version))
  } catch {
    return null
  }
}

/** The catalog's freshness against the running core, computed once when the plugin's runtime starts. */
class GuideFreshnessRef extends Context.Service<GuideFreshnessRef, GuideFreshness>()('@dshfiles/plugin-guide/GuideFreshness') {
  static readonly layer = Layer.sync(GuideFreshnessRef, () => PluginGuide.freshness(GUIDE_CATALOG, runtimeDshVersion()))
}

/** Serves the build-time catalog read-only. It never calls Cordis Inspect or reads live slot registrations. */
export default DshxPlugin.make({
  name: 'dshfiles-plugin-guide',
  layer: GuideFreshnessRef.layer,
  apis: [
    Api.bind(pluginGuideApi, {
      catalog: () => GuideFreshnessRef.use(freshness => Effect.succeed({ freshness, catalog: GUIDE_CATALOG })),
      search: input => GuideFreshnessRef.use(freshness => Effect.sync(() => ({ freshness, ...PluginGuide.search(GUIDE_CATALOG, input) }))),
    }),
  ],
})
