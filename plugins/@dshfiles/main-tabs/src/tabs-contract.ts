/**
 * What other plugins import to read and drive the main tab strip. Published as the `@dshfiles/main-tabs/tabs-contract`
 * dshx module; importing it loads none of the strip's runtime.
 */
import { defineContract, type Subscribable } from '@dshfiles/dshx/client'
import type { HostTarget, WorkbenchTab } from '@dshfiles/workbench/tabs'

export interface OpenMainTabOptions {
  /** Open beside the current tab; otherwise the user's open mode decides whether it replaces the preview tab. */
  readonly newTab?: boolean
  /** Names a scoped panel tab until the panel publishes its own title. */
  readonly title?: string
}

/** The main tab strip, provided while `@dshfiles/main-tabs` runs. */
export interface MainTabsService {
  /** The current project's tabs in strip order; empty while tabs are switched off. */
  readonly tabs: Subscribable<readonly WorkbenchTab[]>
  /**
   * Open a thread or main panel in a tab, or select the tab that already shows it.
   * @returns the tab id, or undefined while tabs are off or the thread is not listed.
   */
  open(target: HostTarget, options?: OpenMainTabOptions): string | undefined
  /** Select a tab of the current strip; false when it has no such tab. */
  focus(tabId: string): boolean
  /** Close a tab of the current strip; false when it has no such tab. */
  close(tabId: string): boolean
}

export const MainTabs = defineContract<MainTabsService>('@dshfiles/main-tabs.tabs', { owner: '@dshfiles/main-tabs' })
