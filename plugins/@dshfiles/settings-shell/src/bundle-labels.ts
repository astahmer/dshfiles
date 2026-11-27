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

/** A manifest title people can read, so its description may show; the English title decides. */
const authoredTitle = (row: BundleLabel): boolean => row.title !== undefined && !restatesAnId(englishOf(row.title), row)

/**
 * One row's manifest text in the active language. A section description is authored or absent: core fills a manifest
 * that wrote nothing with the package name and the package `description` (a note from one developer to another, and
 * for a core row machine-translated), so the description counts only when the manifest also titled the row for
 * people. The English title decides, so every language agrees. `bundleDescription` is never shown.
 */
export const namespaceLabelOf = (row: BundleLabel, resolveText: (text: DisplayText) => string): NamespaceDisplayText => {
  // A package name is no title; without manifest text the page falls back to the schema or the id.
  const resolvedTitle = row.title === undefined ? '' : resolveText(row.title)
  const authored = authoredTitle(row)
  return {
    title: resolvedTitle === row.bundleName || resolvedTitle === row.moduleName ? '' : resolvedTitle,
    description: authored && row.description !== undefined ? resolveText(row.description) : '',
  }
}

const textIn = (text: DisplayText, languages: ReadonlySet<string>): DisplayText =>
  typeof text === 'string'
    ? text
    : { ...Object.fromEntries(Object.entries(text).filter(([language]) => languages.has(language.toLowerCase()))), en: text.en }

/**
 * What one reader needs of the labels: the languages of its fallback chain (English always), no package
 * `bundleDescription` and no description {@link namespaceLabelOf} would not show. Every manifest carries eight
 * languages, so the whole set was ~470 KB per page load for text in one of them; each row still resolves to the same
 * title and description for that chain.
 */
const namespaceLabelsFor = (rows: readonly BundleLabel[], chain: readonly string[]): readonly BundleLabel[] => {
  const languages = new Set(chain.map(language => language.toLowerCase()))
  return rows.map(row => ({
    rowId: row.rowId,
    moduleName: row.moduleName,
    bundleName: row.bundleName,
    ...(row.official !== undefined && { official: row.official }),
    ...(row.title !== undefined && { title: textIn(row.title, languages) }),
    ...(authoredTitle(row) && row.description !== undefined && { description: textIn(row.description, languages) }),
  }))
}

/** The locale ids `LocaleRuntime.resolveText` consults for the active locale, lowercased, ending in English. */
const languageChainOf = (snapshot: {
  readonly active: string
  readonly locales: readonly { readonly id: string; readonly fallback?: string | undefined }[]
}): readonly string[] => {
  const byKey = new Map(snapshot.locales.map(locale => [locale.id.toLowerCase(), locale]))
  const chain: string[] = []
  let current = byKey.get(snapshot.active.toLowerCase())
  while (current !== undefined && !chain.includes(current.id.toLowerCase())) {
    chain.push(current.id.toLowerCase())
    current = current.fallback === undefined ? undefined : byKey.get(current.fallback.toLowerCase())
  }
  if (!chain.includes('en')) chain.push('en')
  return chain
}

/** The labels in one reader's languages: its fallback chain, and the rows trimmed to it. */
export class LabelLanguages {
  static readonly chainOf = languageChainOf
  static readonly trim = namespaceLabelsFor
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
