import { SidebarResourcePanelModel } from '@dshfiles/sidebar-right/resource-panels'

/**
 * Thread pages a saved layout restored after their thread's record went away: the layout keeps the panel id and its
 * last title, but the native owner no longer lists the page and nothing registers it.
 */
export class OrphanedResourcePanels {
  /**
   * The restored panel a thread page arriving now takes the place of, so the same view is not restored twice
   * ("Changes · Changes"). Only an unregistered, unlisted resource panel with the same title counts: a registered
   * panel, a page the native owner still lists, and a panel of another plugin keep their place.
   */
  static replacedBy(
    page: { readonly id: string; readonly title: string },
    panels: readonly { readonly id: string; readonly title: string | undefined }[],
    known: { readonly registered: (id: string) => boolean; readonly listed: (id: string) => boolean },
  ): string | undefined {
    return panels.find(
      panel =>
        panel.id !== page.id &&
        panel.title === page.title &&
        SidebarResourcePanelModel.sessionIdOf(panel.id) !== undefined &&
        !known.registered(panel.id) &&
        !known.listed(panel.id),
    )?.id
  }
}
