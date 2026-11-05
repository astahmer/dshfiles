import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { GUIDE_KINDS, guideCatalogSchema, guideEntrySchema, PluginGuide } from './catalog-model.js'

const freshnessSchema = Schema.Struct({
  catalogDshVersion: Schema.String,
  runtimeDshVersion: Schema.NullOr(Schema.String),
  stale: Schema.Boolean,
  reasons: Schema.Array(Schema.String),
})

const searchResultSchema = Schema.Struct({ freshness: freshnessSchema, total: Schema.Number, entries: Schema.Array(guideEntrySchema) })

export const pluginGuideApi = defineApi({
  id: 'plugin-guide',
  version: 1,
  owner: '@dshfiles/plugin-guide',
  methods: {
    catalog: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ freshness: freshnessSchema, catalog: guideCatalogSchema }),
      description:
        'The whole static Plugin Guide catalog for the developer page, with whether it matches the running DSH. Generated at build time from public declarations; occupancy is never live.',
    }),
    search: method({
      input: Schema.Struct({
        query: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
        kind: Schema.optional(Schema.Literals(GUIDE_KINDS)),
        limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 200 }))),
      }),
      output: searchResultSchema,
      description:
        'Search the DSH plugin extension surfaces a plugin may use: dshx SDK entry points, native Client slots, owned registries, client contracts, Host APIs, shared modules and feature-catalog surfaces. Each entry names its import, scope, mode, registration shape, additive-or-replacement risk, source file and docs. Static build-time catalog, never live occupancy. Read-only.',
      tool: { name: 'plugin_guide_search', readOnly: true, render: PluginGuide.render },
    }),
  },
})
