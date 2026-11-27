import type { DockviewApi } from 'dockview-react'
import { NewViewTabs } from './new-view.js'

/**
 * The phone thread panel's last real view (plan phone P15): the sheet used to open on "Choose a view" every time,
 * because the dock's active panel starts as a chooser. Remember the last panel that was not a chooser, per page load,
 * so reopening the sheet resumes where the owner left off. Explicit requests (a Changes pill, a plugin's open) set
 * their own active panel first and are never redirected.
 */
export const PhoneRightPaneModel = {
  /**
   * Which remembered panel the sheet should resume, if any.
   * @param input.activeId - the dock's current active panel id.
   * @param input.lastId - the last non-chooser panel id seen.
   * @param input.available - whether the dock still holds that panel.
   * @returns the id to activate, or undefined to leave the sheet as it is.
   */
  resumePanel: (input: {
    readonly activeId: string | undefined
    readonly lastId: string | undefined
    readonly available: (id: string) => boolean
  }): string | undefined => {
    if (input.activeId !== undefined && !NewViewTabs.isChooser(input.activeId)) return undefined
    if (input.lastId === undefined || !input.available(input.lastId)) return undefined
    return input.lastId
  },
} as const

let lastPanelId: string | undefined

/** Record the last non-chooser panel shown in the right dock; dispose the returned subscription with the dock. */
export const rememberPhoneRightPanel = (api: DockviewApi): (() => void) => {
  const subscription = api.onDidActivePanelChange(event => {
    const id = event.panel?.id
    if (id !== undefined && !NewViewTabs.isChooser(id)) lastPanelId = id
  })
  return () => subscription.dispose()
}

/** The last non-chooser panel shown in this page load, if any. */
export const lastPhoneRightPanel = (): string | undefined => lastPanelId
