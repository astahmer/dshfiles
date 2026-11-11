import * as Schema from 'effect/Schema'

/** Mirrors `DSHX_ONBOARDING_PREREQUISITES` in the dshx feature schema; the catalog test decodes every generated block with it. */
export const PREREQUISITES = ['account', 'project', 'repository', 'github'] as const
export type Prerequisite = (typeof PREREQUISITES)[number]

const routeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))

/** One supported way to open a feature: a main panel, a contributed command, or a Settings place. */
export const routeSchema = Schema.Union([
  Schema.Struct({ panel: routeId }),
  Schema.Struct({ command: routeId }),
  Schema.Struct({
    settings: Schema.Union([Schema.Struct({ section: routeId }), Schema.Struct({ entryId: routeId, fieldPath: Schema.Array(routeId) })]),
  }),
])
export type Route = typeof routeSchema.Type

export const onboardingBlockSchema = Schema.Struct({
  prerequisites: Schema.optional(Schema.Array(Schema.Literals(PREREQUISITES))),
  firstAction: Schema.String,
  doneWhen: Schema.String,
  open: Schema.optional(routeSchema),
})
export type OnboardingBlock = typeof onboardingBlockSchema.Type

export const catalogFeatureSchema = Schema.Struct({
  key: Schema.String,
  plugin: Schema.String,
  id: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  destination: Schema.String,
  currentSurface: Schema.NullOr(Schema.String),
  reach: Schema.Array(Schema.String),
  onboarding: Schema.NullOr(onboardingBlockSchema),
})
export type CatalogFeature = typeof catalogFeatureSchema.Type

export const catalogPluginSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** The plugin's catalog lists a `client` surface: it has UI a user can find. */
  ui: Schema.Boolean,
  features: Schema.Number,
})
export type CatalogPlugin = typeof catalogPluginSchema.Type

export const featureCatalogSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedFrom: Schema.Array(Schema.String),
  plugins: Schema.Array(catalogPluginSchema),
  features: Schema.Array(catalogFeatureSchema),
})
export type FeatureCatalog = typeof featureCatalogSchema.Type
