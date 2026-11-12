import type { ShellMergeRequest } from '@dshfiles/workbench/shell-merge'
import type { SidebarPreferences } from './organization.js'

/**
 * One sidebar layout (b:952m). The rail and its list are one Workbench pane, the Sidebar pane, that can move, split and
 * float like any other. The sidebar root still renders that column (it holds the Host's panel list, the stage and the
 * phone shell), and portals it into whichever element the pane currently lends: one element per page, the visible
 * occurrence's. None is lent while the pane is not in any layout, or before the Workbench mounted it.
 */
const listeners = new Set<() => void>()
let host: HTMLElement | null = null

const publish = (next: HTMLElement | null): void => {
  if (host === next) return
  host = next
  for (const listener of [...listeners]) listener()
}

export class SidebarDockHost {
  /** Lend this element; the returned release only clears it while it is still the lent one. */
  static attach(element: HTMLElement): () => void {
    publish(element)
    return () => {
      if (host === element) publish(null)
    }
  }

  static readonly get = (): HTMLElement | null => host

  static subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

/**
 * The one-time merge of the two former layouts. It waits for the Host settings to settle (a fallback read would take a
 * Free docking user for a Fixed one), then files the browser-side request with the Workbench; the one page that finds
 * no Host marker also writes it, with the Host-synced changes a Free docking user needs (the row under the list, which
 * Free docking always showed).
 */
export class LayoutMerge {
  static decide(input: {
    readonly settled: boolean
    readonly hostBacked: boolean
    /** The Host settings schema declares the marker; an older Host before its restart does not. */
    readonly markerOnHost: boolean
    readonly preferences: Pick<SidebarPreferences, 'layoutMode' | 'layoutMerge'>
  }): { readonly request: ShellMergeRequest; readonly hostPatch: Partial<SidebarPreferences> | null } | null {
    if (!input.settled) return null
    const former = input.preferences.layoutMerge ?? input.preferences.layoutMode
    const firstOnHost = input.hostBacked && input.markerOnHost && input.preferences.layoutMerge === null
    const marker: Partial<SidebarPreferences> = { layoutMerge: former }
    const hostPatch = !firstOnHost ? null : former === 'docking' ? { ...marker, showFooter: true } : marker
    return { request: { former, firstOnHost }, hostPatch }
  }
}
