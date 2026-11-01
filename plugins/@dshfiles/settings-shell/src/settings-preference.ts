import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

/** Where Settings shows: the dialog, the main view (a tab), or the right sidebar's side panel. */
export type SettingsSurface = 'modal' | 'tab' | 'sidebar'

const openInSchema = Schema.Struct({ openIn: Schema.Literals(['auto', 'tab', 'modal', 'sidebar']) })

/**
 * Where Settings opens: the user's `openIn`, where `auto` means a tab exactly when main-tabs gives the main view tabs.
 * An unserved or malformed namespace reads as `auto`, so an older Host keeps the dialog.
 */
export const preferredSurface = (input: { readonly settings: unknown; readonly tabsLoaded: boolean }): SettingsSurface => {
  const parsed = Schema.decodeUnknownOption(openInSchema)(input.settings)
  const openIn = Option.isSome(parsed) ? parsed.value.openIn : 'auto'
  if (openIn === 'auto') return input.tabsLoaded ? 'tab' : 'modal'
  return openIn
}
