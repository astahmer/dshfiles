/**
 * Which rows the sidebar files in the command palette, as rules a test can read. One row opens one page: a destination
 * whose list is a single page does not also get a "Go to" row, and a page named like its destination is not written
 * twice ("Inbox › Inbox"). A verb (toggle the sidebar, restart, pair a phone) is a command, never a destination.
 */
import type { ResolvedDestination } from './destinations.js'

/** The built-in command for the same toggle as the sidebar's Toggle sidebar row: the sidebar lists its own row, not both. */
export const HOST_TOGGLE_SIDEBAR_COMMAND = 'sidebar.left.toggle'

/** The palette group of the sidebar's verbs. */
export const SIDEBAR_VERB_GROUP = 'command' as const

/** Destinations that keep a "Go to" row: every one but those whose single page already has its own row. */
const destinationsWithGoTo = (input: {
  readonly destinations: readonly Pick<ResolvedDestination, 'id' | 'sections'>[]
  /** Page ids the palette already lists a row for. */
  readonly listedPageIds: ReadonlySet<string>
}): ReadonlySet<string> =>
  new Set(
    input.destinations
      .filter(destination => {
        if (destination.id === 'threads' || destination.id === 'settings') return true
        const only = destination.sections.length === 1 ? destination.sections[0] : undefined
        return only === undefined || !input.listedPageIds.has(only.panelId)
      })
      .map(destination => destination.id),
  )

/** "Observe › Usage"; a page named like its destination is just that name. */
const pageLabel = (destinationLabel: string, sectionLabel: string): string =>
  destinationLabel === sectionLabel ? sectionLabel : `${destinationLabel} › ${sectionLabel}`

export class SidebarPaletteRows {
  static readonly destinationsWithGoTo = destinationsWithGoTo
  static readonly pageLabel = pageLabel
}
