import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager/types'
import * as Schema from 'effect/Schema'

/** Literal text, or translations by language id with the English fallback core always fills. */
export const displayTextSchema = Schema.Union([
  Schema.String,
  Schema.StructWithRest(Schema.Struct({ en: Schema.String }), [Schema.Record(Schema.String, Schema.String)]),
])

/** One Loader row's display text from its bundle manifest, before the Client resolves it for the active locale. */
export const bundleLabelSchema = Schema.Struct({
  rowId: Schema.String,
  moduleName: Schema.String,
  bundleName: Schema.String,
  official: Schema.optional(Schema.Boolean),
  title: Schema.optional(displayTextSchema),
  description: Schema.optional(displayTextSchema),
  bundleDescription: Schema.optional(Schema.String),
})

export type BundleLabel = typeof bundleLabelSchema.Type

/** What Settings shows for one namespace: empty strings where the manifest wrote nothing for people. */
export interface NamespaceDisplayText {
  readonly title: string
  readonly description: string
}

type DisplayText = NonNullable<BundleLabel['title']>

const englishOf = (text: DisplayText): string => (typeof text === 'string' ? text : text.en)

/** A title that is a package, module or row id ("@dshfiles/editor", "llm-deepseek-account"), not words for a person. */
const restatesAnId = (title: string, row: BundleLabel): boolean =>
  title === '' || title === row.bundleName || title === row.moduleName || title === row.rowId || /^[@a-z0-9][a-z0-9@/._-]*$/u.test(title)

/**
 * One row's manifest text in the active language. A section description is authored or absent: core fills a manifest
 * that wrote nothing with the package name and the package `description` (a note from one developer to another, and
 * for a core row machine-translated), so the description counts only when the manifest also titled the row for
 * people. The English title decides, so every language agrees. `bundleDescription` is never shown.
 */
export const namespaceLabelOf = (row: BundleLabel, resolveText: (text: DisplayText) => string): NamespaceDisplayText => {
  // A package name is no title; without manifest text the page falls back to the schema or the id.
  const resolvedTitle = row.title === undefined ? '' : resolveText(row.title)
  const authored = row.title !== undefined && !restatesAnId(englishOf(row.title), row)
  return {
    title: resolvedTitle === row.bundleName || resolvedTitle === row.moduleName ? '' : resolvedTitle,
    description: authored && row.description !== undefined ? resolveText(row.description) : '',
  }
}

/** Each row's own manifest text, else its bundle's. */
export const bundleLabelsOf = (bundles: readonly BundleInfo[]): readonly BundleLabel[] =>
  bundles.flatMap(bundle =>
    bundle.rows.map(row => ({
      rowId: row.rowId,
      moduleName: row.moduleName,
      bundleName: bundle.name,
      official: bundle.official,
      title: row.meta?.title ?? bundle.meta?.title,
      description: row.meta?.description ?? bundle.meta?.description,
      bundleDescription: bundle.description,
    })),
  )
