import { z } from 'zod'
import { humanizeKey, namespaceText, settingFields, type JsonValue, type LocalizedTextReader, type SettingField } from './schema-form/schema-model.js'

/** One settings namespace, as `settings.describe` reports it. */
export interface NamespaceDescription {
  readonly ns: string
  readonly schema: JsonValue
  readonly secrets?: readonly { readonly path: readonly string[] }[]
  /** False for a namespace whose plugin draws its own Settings page; its fields still show under "More settings". */
  readonly autoGenerate: boolean
}

/** Display text a bundle's manifest gives one of its rows; the row id is the settings namespace. */
export interface NamespaceLabel {
  readonly title: string
  readonly description: string
}

export interface PluginSettingsPage {
  /** Nav id, prefixed so it never collides with a `settings.section` id. */
  readonly pageId: string
  readonly ns: string
  readonly title: string
  readonly description: string
  readonly group: 'plugins' | 'more'
  readonly fields: readonly SettingField[]
}

const PAGE_PREFIX = 'plugin:'

export const pluginPageId = (ns: string): string => `${PAGE_PREFIX}${ns}`

/** The namespace a nav id opens, or undefined for a `settings.section` id. */
export const namespaceOfPage = (pageId: string | undefined): string | undefined =>
  pageId?.startsWith(PAGE_PREFIX) === true ? pageId.slice(PAGE_PREFIX.length) : undefined

/**
 * One page per namespace with at least one visible setting: titled by its bundle's manifest, else its schema, else
 * its id. Namespaces without a page of their own are the "Plugins" group; the rest, whose plugins draw native pages,
 * are "More settings", so search can still reach every field.
 */
export const pluginSettingsPages = (input: {
  readonly namespaces: readonly NamespaceDescription[]
  readonly labels: ReadonlyMap<string, NamespaceLabel>
  readonly text: LocalizedTextReader
}): readonly PluginSettingsPage[] =>
  input.namespaces
    .flatMap(namespace => {
      const fields = settingFields({ schema: namespace.schema, secrets: namespace.secrets ?? [], text: input.text })
      if (fields.length === 0) return []
      const own = namespaceText({ schema: namespace.schema, text: input.text })
      const label = input.labels.get(namespace.ns)
      return [
        {
          pageId: pluginPageId(namespace.ns),
          ns: namespace.ns,
          title: label?.title || own.title || humanizeKey(namespace.ns.replace(/^dshfiles-/u, '')),
          description: label?.description || own.description,
          group: namespace.autoGenerate ? ('plugins' as const) : ('more' as const),
          fields,
        },
      ]
    })
    .sort((left, right) => left.title.localeCompare(right.title))

const translationsSchema = z.record(z.string(), z.string())

/** Reads a schemastery description or manifest text in the active language, falling back to English. */
export const localizedTextReader =
  (locale: string): LocalizedTextReader =>
  value => {
    const plain = z.string().safeParse(value)
    if (plain.success) return plain.data
    const translations = translationsSchema.safeParse(value)
    if (!translations.success) return ''
    return translations.data[locale] ?? translations.data.en ?? Object.values(translations.data)[0] ?? ''
  }
