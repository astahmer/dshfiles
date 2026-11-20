import type { SidebarPreferences } from './organization.js'

export type RailActionId = 'restart' | 'reload' | 'copy-url' | 'pair-phone'

type RailPreferences = Pick<SidebarPreferences, 'showRailActions' | 'showRailRestart'>

/**
 * Restart is on the rail only for someone who turned it on. By default the status strip's restart item is the one
 * restart control (DESIGN.md: never a second control for restart): it shows what waits, and its verbs.
 */
const restartOnRail = (input: { readonly preferences: RailPreferences; readonly restartAvailable: boolean }): boolean =>
  input.preferences.showRailActions && input.preferences.showRailRestart && input.restartAvailable

/**
 * The DSH actions the rail draws above Settings, in order. A pending page reload stays: it shows only while it carries
 * that state, and nothing else on screen offers it.
 */
const shown = (input: {
  readonly preferences: RailPreferences
  readonly restartAvailable: boolean
  readonly reloadPending: boolean
  readonly launchUrl: boolean
  readonly pairingAvailable: boolean
}): readonly RailActionId[] => {
  if (!input.preferences.showRailActions) return []
  const ids: RailActionId[] = []
  if (restartOnRail(input)) ids.push('restart')
  if (input.reloadPending) ids.push('reload')
  if (input.launchUrl) ids.push('copy-url')
  if (input.pairingAvailable) ids.push('pair-phone')
  return ids
}

export class RailActionsModel {
  static readonly restartOnRail = restartOnRail
  static readonly shown = shown
}
