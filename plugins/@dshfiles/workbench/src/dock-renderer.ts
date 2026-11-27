/** Which Dockview renderer a workbench surface uses: `always` keeps every panel mounted, `onlyWhenVisible` unmounts hidden ones. */
export type WorkbenchPanelRenderer = 'always' | 'onlyWhenVisible'

/**
 * Phone workbench surfaces unmount the panels nobody is looking at (plan phone P15): a hidden Changes, Jujutsu or
 * Traces panel still runs its React tree and its queries on a phone. Desktop keeps `always`, where panel state such as
 * an editor draft survives a tab switch.
 */
export const dockRenderer = (unmountHiddenViews: boolean): WorkbenchPanelRenderer => (unmountHiddenViews ? 'onlyWhenVisible' : 'always')
