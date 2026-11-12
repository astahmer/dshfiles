import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { SettingsSchemaModel, type JsonValue, type LocalizedTextReader, type SettingField } from './schema-form/schema-model.js'

/** One settings namespace, as `settings.describe` reports it. */
interface NamespaceDescription {
  readonly ns: string
  readonly schema: JsonValue
  readonly secrets?: readonly { readonly path: readonly string[] }[]
  /** False for a namespace whose plugin draws its own Settings page; its fields still show under "More settings". */
  readonly autoGenerate: boolean
  /** The raw user layer: a field present here is modified. */
  readonly user?: JsonValue
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
  /** Dotted paths of the fields the user layer sets, for the `@modified` search filter. */
  readonly modifiedPaths: readonly string[]
}

const PAGE_PREFIX = 'plugin:'
const translationsSchema = Schema.Record(Schema.String, Schema.String)

export class SettingsPluginPages {
  static pluginPageId = (ns: string): string => `${PAGE_PREFIX}${ns}`

  /**
   * One page per namespace with at least one visible setting: titled by its bundle's manifest, else its schema, else
   * its id. The description is the schema's own when it has one (written for this form), else the manifest's, whose
   * fallback is the package description written for developers. Namespaces without a page of their own are the "Plugins" group; the rest, whose plugins draw native pages,
   * are "More settings", so search can still reach every field.
   */
  static pluginSettingsPages = (input: {
    readonly namespaces: readonly NamespaceDescription[]
    readonly labels: ReadonlyMap<string, NamespaceLabel>
    readonly text: LocalizedTextReader
  }): readonly PluginSettingsPage[] =>
    input.namespaces
      .flatMap(namespace => {
        const fields = SettingsSchemaModel.settingFields({ schema: namespace.schema, secrets: namespace.secrets ?? [], text: input.text })
        if (fields.length === 0) return []
        const own = SettingsSchemaModel.namespaceText({ schema: namespace.schema, text: input.text })
        const label = input.labels.get(namespace.ns)
        return [
          {
            pageId: SettingsPluginPages.pluginPageId(namespace.ns),
            ns: namespace.ns,
            title: label?.title || own.title || SettingsSchemaModel.humanizeKey(namespace.ns.replace(/^dshfiles-/u, '')),
            description: own.description || label?.description || '',
            group: namespace.autoGenerate ? ('plugins' as const) : ('more' as const),
            fields,
            modifiedPaths: fields.filter(field => SettingsSchemaModel.hasValueAt(namespace.user, field.path)).map(field => field.path.join('.')),
          },
        ]
      })
      .sort((left, right) => left.title.localeCompare(right.title))

  /** Reads a schemastery description or manifest text in the active language, falling back to English. */
  static localizedTextReader =
    (locale: string): LocalizedTextReader =>
    value => {
      if (Schema.is(Schema.String)(value)) return value
      const translations = Schema.decodeUnknownOption(translationsSchema)(value)
      if (Option.isNone(translations)) return ''
      return translations.value[locale] ?? translations.value.en ?? Object.values(translations.value)[0] ?? ''
    }
}
