import type { MainNavigationResult } from '@dshfiles/workbench/registry'

/** The frame that showed the Backlog page: a Workbench tab occurrence, or the native main panel. */
export type BacklogShown = MainNavigationResult['kind']

export class BacklogNavigation {
  /**
   * Show the page where this build puts it. The Workbench owns the Backlog tab (and picks the occurrence), so selecting
   * the native main panel as well would navigate the frame out from under it.
   */
  static readonly show = async (options: {
    readonly workbench: () => Promise<MainNavigationResult>
    readonly selectMainPanel: () => void
  }): Promise<BacklogShown> => {
    const result = await options.workbench()
    if (result.kind === 'native') options.selectMainPanel()
    return result.kind
  }
}
