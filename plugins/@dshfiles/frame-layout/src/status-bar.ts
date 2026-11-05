/** The Settings section that lists the status bar items; the strip's context menu opens it. */
export const STATUS_BAR_SECTION_ID = 'dshfiles-status-bar'

export const openStatusBarSettings = (): void => {
  window.dispatchEvent(new CustomEvent('dshfiles:open-settings', { detail: { section: STATUS_BAR_SECTION_ID }, cancelable: true }))
}
