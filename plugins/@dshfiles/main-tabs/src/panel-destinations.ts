import { DESTINATIONS, KNOWN_SECTIONS, type DestinationSection } from '@dshfiles/thread-sidebar/destinations'
import type { TabDestination } from '@dshfiles/workbench/tabs'

/**
 * The rail destination a page tab belongs to (round five B4), placed as the left column places it: a contributed
 * section wins over the built-in table, a developer page and a page nobody mapped live in Settings. The tab strips draw
 * its glyph before the title, in its nav tone on the tab on screen.
 */
const of = (panelId: string, contributed: readonly DestinationSection[] = []): TabDestination => {
  const section = contributed.findLast(candidate => candidate.panelId === panelId) ?? KNOWN_SECTIONS.find(candidate => candidate.panelId === panelId)
  const id = section === undefined || section.group === 'developer' ? 'settings' : section.destination
  const destination = DESTINATIONS.find(candidate => candidate.id === id) ?? DESTINATIONS.at(-1)
  return destination === undefined ? { id: 'settings', icon: 'settings' } : { id: destination.id, icon: destination.icon }
}

export class PanelDestinationsModel {
  static readonly of = of
}
