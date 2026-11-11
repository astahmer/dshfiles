import type { Route } from './catalog-model.js'
import { dispatchOpenSettings } from '@dshfiles/settings-shell/open-settings'

/** The supported navigation verbs a route resolves to; a route whose target is not registered here has no button. */
export interface RouteServices {
  readonly hasPanel: (panelId: string) => boolean
  readonly openPanel: (panelId: string) => boolean
  readonly hasCommand: (commandId: string) => boolean
  readonly runCommand: (commandId: string) => boolean
  readonly hasSettings: () => boolean
  readonly openSettings: (request: SettingsRequest) => boolean
}

export type SettingsRequest = { readonly section: string } | { readonly setting: { readonly entryId: string; readonly fieldPath: readonly string[] } }

const settingsRequestOf = (route: Extract<Route, { readonly settings: unknown }>): SettingsRequest =>
  'section' in route.settings ? { section: route.settings.section } : { setting: { entryId: route.settings.entryId, fieldPath: route.settings.fieldPath } }

const available = (route: Route | null, services: RouteServices): boolean => {
  if (route === null) return false
  if ('panel' in route) return services.hasPanel(route.panel)
  if ('command' in route) return services.hasCommand(route.command)
  return services.hasSettings()
}

const open = (route: Route, services: RouteServices): boolean => {
  if ('panel' in route) return services.openPanel(route.panel)
  if ('command' in route) return services.runCommand(route.command)
  return services.openSettings(settingsRequestOf(route))
}

export class Routes {
  static readonly available = available
  static readonly open = open
  static readonly dispatchOpenSettings = dispatchOpenSettings
}
