type SelectPanelInfo = (selector: (info: { readonly activePanelId: string | null }) => boolean) => boolean
type ReadTabInfo = () => { readonly tab: { readonly visible: boolean } }

/** A `main` entry is on screen only while it is the selected main panel; polling pauses otherwise. */
const useMainPanelVisible = (input: { readonly usePanelInfo: SelectPanelInfo; readonly panelId: string }): boolean =>
  input.usePanelInfo(info => info.activePanelId === input.panelId)

/** A right-pane tab stays mounted behind other tabs, a collapsed pane and background Sessions; only `visible` is on screen. */
const useSideTabVisible = (useTabInfo: ReadTabInfo): boolean => useTabInfo().tab.visible

export const SurfaceVisibility = { useMainPanelVisible, useSideTabVisible }
