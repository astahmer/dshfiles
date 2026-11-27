import * as Schema from 'effect/Schema'

/** Who ships a bundle: stock DSH, this repository, or anyone else. */
export const pluginBundleOriginSchema = Schema.Literals(['dshfiles', 'dsh', 'community'])
export type PluginBundleOrigin = typeof pluginBundleOriginSchema.Type

/** Whether a Settings entry ships with stock DSH or comes from a plugin bundle. */
export type SettingsEntryOrigin = 'dsh' | 'plugin'

interface BundleIdentity {
  readonly name: string
  readonly official?: boolean | undefined
}

const bundleOrigin = (bundle: BundleIdentity): PluginBundleOrigin => {
  if (bundle.name.startsWith('@dshfiles/')) return 'dshfiles'
  if (bundle.official === true || bundle.name.startsWith('@deepseek-ai/')) return 'dsh'
  return 'community'
}

/** The one rule that tells stock DSH from plugins, for the bundle list and for Settings entries alike. */
export class Origin {
  static readonly ofBundle = bundleOrigin

  static readonly settingsOfBundle = (bundle: BundleIdentity): SettingsEntryOrigin => (bundleOrigin(bundle) === 'dsh' ? 'dsh' : 'plugin')

  /** Search words that find an entry by its origin and owning package. */
  static readonly keywords = (input: { readonly origin: SettingsEntryOrigin; readonly bundleName: string | undefined }): readonly string[] => [
    input.origin === 'dsh' ? 'dsh default core' : 'plugin',
    ...(input.bundleName === undefined ? [] : [input.bundleName]),
  ]
}
