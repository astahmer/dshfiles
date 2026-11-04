import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager/types'
import * as Schema from 'effect/Schema'

/** Literal text, or translations by language id with the English fallback core always fills. */
const displayTextSchema = Schema.Union([
  Schema.String,
  Schema.StructWithRest(Schema.Struct({ en: Schema.String }), [Schema.Record(Schema.String, Schema.String)]),
])

/** One Loader row's display text from its bundle manifest, before the Client resolves it for the active locale. */
export const bundleLabelSchema = Schema.Struct({
  rowId: Schema.String,
  moduleName: Schema.String,
  bundleName: Schema.String,
  title: Schema.optional(displayTextSchema),
  description: Schema.optional(displayTextSchema),
  bundleDescription: Schema.optional(Schema.String),
})

export type BundleLabel = typeof bundleLabelSchema.Type

/** Each row's own manifest text, else its bundle's. */
export const bundleLabelsOf = (bundles: readonly BundleInfo[]): readonly BundleLabel[] =>
  bundles.flatMap(bundle =>
    bundle.rows.map(row => ({
      rowId: row.rowId,
      moduleName: row.moduleName,
      bundleName: bundle.name,
      title: row.meta?.title ?? bundle.meta?.title,
      description: row.meta?.description ?? bundle.meta?.description,
      bundleDescription: bundle.description,
    })),
  )
