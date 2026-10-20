/**
 * A main panel asks for its right-sidebar view through this cancelable window event. The plugin that owns both
 * surfaces answers; an unanswered dispatch means this panel has no side-panel view here, so the strip keeps its tab.
 */
export const PANEL_ASIDE_EVENT = 'dshfiles:move-panel-aside'

/** Ask for one panel's side-panel view; false leaves the panel in the main strip. */
export const requestPanelAside = (panelId: string): boolean =>
  !window.dispatchEvent(new CustomEvent(PANEL_ASIDE_EVENT, { detail: { panelId }, cancelable: true }))
