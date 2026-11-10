import { KNOWN_SECTIONS, type DestinationSection } from '@dshfiles/thread-sidebar/destinations'
import { panelTabTitle, type PanelTitle } from '@dshfiles/workbench/registry'

/**
 * Tab titles for pages the shell lists as destination sections (plan `docs/ade-ux` §5: labels never show plugin
 * names). "Usage: Analytics" becomes "Usage", the section's own label; contributed sections win over the built-in table.
 */
const destinationTitles = (contributed: readonly DestinationSection[]): readonly PanelTitle[] =>
  [...KNOWN_SECTIONS, ...contributed].map(section => ({ panelId: section.panelId, title: section.label }))

/** One main panel's tab title from its navigation label: a destination section label, else the label without its prefix. */
const titleOf = (panelId: string, navigationLabel: string | undefined, titles: readonly PanelTitle[]): string | undefined =>
  panelTabTitle(panelId, navigationLabel, titles)

export class PanelTitlesModel {
  static readonly destinationTitles = destinationTitles
  static readonly titleOf = titleOf
}
