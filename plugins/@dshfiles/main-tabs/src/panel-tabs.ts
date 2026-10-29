import { z } from 'zod'
import type { HostTarget, TabTarget } from '@dshfiles/workbench/tabs'

/**
 * A panel tab may name a scope: one panel plugin showing a different subject per tab (Jujutsu on two repositories).
 * The Host still knows one main panel per key, so the scope never reaches it; main-tabs tells the panel which scope
 * its tab asks for through `PANEL_SCOPE_EVENT`, right before navigating, and keeps the scope on the tab.
 */
export const OPEN_PANEL_TAB_EVENT = 'dshfiles:open-panel-tab'
export const PANEL_SCOPE_EVENT = 'dshfiles:panel-scope'
export const PANEL_TAB_TITLE_EVENT = 'dshfiles:panel-tab-title'

const idSchema = z.string().min(1).max(512)
const titleSchema = z.string().min(1).max(200)
const openPanelTabSchema = z.object({ panelId: idSchema, scope: idSchema, title: titleSchema.optional() }).strict()
const panelTabTitleSchema = z.object({ panelId: idSchema, scope: idSchema, title: titleSchema }).strict()

export interface OpenPanelTabRequest {
  readonly panelId: string
  readonly scope: string
  readonly title?: string | undefined
}

export interface PanelTabTitle {
  readonly panelId: string
  readonly scope: string
  readonly title: string
}

/** The window events and tab identities one panel plugin uses to keep a tab per subject. */
export class PanelTabs {
  /** Ask main-tabs for a tab on one panel scope; dispatching is open to any plugin, the tab itself is main-tabs'. */
  static request(request: OpenPanelTabRequest): void {
    window.dispatchEvent(new CustomEvent(OPEN_PANEL_TAB_EVENT, { detail: request }))
  }

  static readRequest(event: Event): OpenPanelTabRequest | undefined {
    if (!(event instanceof CustomEvent)) return undefined
    const parsed = openPanelTabSchema.safeParse(event.detail)
    return parsed.success ? parsed.data : undefined
  }

  /** Tell the panel plugin which of its scopes the main view now shows; `null` means its own default. */
  static announce(target: { readonly panelId: string; readonly scope?: string | undefined }): void {
    window.dispatchEvent(new CustomEvent(PANEL_SCOPE_EVENT, { detail: { panelId: target.panelId, scope: target.scope ?? null } }))
  }

  /** A panel publishes the live title of one scoped tab (the repository it now shows); main-tabs persists it. */
  static publishTitle(request: PanelTabTitle): void {
    window.dispatchEvent(new CustomEvent(PANEL_TAB_TITLE_EVENT, { detail: request }))
  }

  static readTitle(event: Event): PanelTabTitle | undefined {
    if (!(event instanceof CustomEvent)) return undefined
    const parsed = panelTabTitleSchema.safeParse(event.detail)
    return parsed.success ? parsed.data : undefined
  }

  static tabId(panelId: string, scope: string): string {
    return `panel:${panelId}#${scope}`
  }

  /**
   * What the main view shows, read as the tab that is on screen: the Host names only the panel, so while a scoped tab of
   * that panel is active it is the scoped target that is reported (and compared against) rather than a bare one.
   */
  static visibleTarget(shown: HostTarget | null, active: TabTarget | null): HostTarget | null {
    if (shown?.kind !== 'panel' || active?.kind !== 'panel' || active.panelId !== shown.panelId) return shown
    return active.scope === undefined || active.scope === shown.scope ? shown : { kind: 'panel', panelId: shown.panelId, scope: active.scope }
  }
}
