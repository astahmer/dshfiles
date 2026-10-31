import type { ReactNode } from 'react'

export type HostTarget =
  | { readonly kind: 'panel'; readonly panelId: string; readonly scope?: string | undefined }
  | { readonly kind: 'thread'; readonly sessionId: string }

/** A tab shows a Host target, or the shared Start suggestions page. */
export type TabTarget = HostTarget | { readonly kind: 'start' }

export type TabStatus = 'running' | 'needsYou' | 'unread'

export const CLOSE_BUTTON_POSITIONS = ['left', 'right'] as const
export type CloseButtonPosition = (typeof CLOSE_BUTTON_POSITIONS)[number]
export const DEFAULT_CLOSE_BUTTON_POSITION: CloseButtonPosition = 'left'

interface TabViewBase {
  readonly id: string
  readonly title: string
  readonly active: boolean
  readonly pinned: boolean
  readonly preview: boolean
  readonly available: boolean
  readonly status: TabStatus | null
}

export type TabView =
  | (TabViewBase & { readonly kind: 'thread'; readonly sessionId: string; readonly workspaceId?: string })
  | (TabViewBase & { readonly kind: 'panel'; readonly panelId: string })
  | (TabViewBase & { readonly kind: 'start' })

/** The existing computed strip view, plus its actor-owned target (including panel scope). */
export type WorkbenchTab = TabView & { readonly target: TabTarget }

export interface WorkbenchTabsSnapshot {
  readonly enabled: boolean
  /** Missing on older providers; Workbench treats it as left. */
  readonly closeButtonPosition?: CloseButtonPosition
  /** The actor's current project/global set, not a second Dockview-owned tab set. */
  readonly scopeKey: string
  readonly activeTabId: string | null
  /** Current native Conversation binding, independent of the selected semantic tool; absent on older providers. */
  readonly currentSessionId?: string | undefined
  readonly tabs: readonly WorkbenchTab[]
}

export interface WorkbenchTabsActions {
  readonly activate: (tabId: string) => void
  readonly close: (tabId: string) => void
  readonly keep: (tabId: string) => void
  readonly togglePin: (tabId: string) => void
  readonly move: (tabId: string, toIndex: number) => void
  readonly closeOthers: (tabId: string) => void
  readonly closeToRight: (tabId: string) => void
  /** Dock the same semantic tab when Workbench owns the frame; native mode closes only after its aside owner accepts. */
  readonly moveAside: (tabId: string) => boolean
  readonly open: (target: TabTarget, newTab?: boolean, title?: string) => void
  readonly newTab: () => void
  /** Start a thread the way the Start page and sidebar do; absent on older providers. */
  readonly newThread?: () => void
  readonly renameThread: (sessionId: string, title: string) => Promise<void>
}

export interface WorkbenchTabsProvider {
  /** Referentially stable until a semantic or metadata change; safe for useSyncExternalStore. */
  readonly getSnapshot: () => WorkbenchTabsSnapshot
  readonly subscribe: (listener: () => void) => () => void
  readonly actions: WorkbenchTabsActions
  /** The existing suggestions page; render only inside the active Start panel. */
  readonly renderStart: () => ReactNode
  /** Native-owner menu and localized labels; absent on older providers. */
  readonly renderTabMenu?: (tabId: string, onRename: () => void, onStatus?: (message: string) => void) => ReactNode
  readonly label?: (key: 'newTab' | 'pinned' | 'running' | 'needsYou' | 'unread' | 'renameThread' | 'renameFailed' | 'closeTab', title?: string) => string
}

const EMPTY_SNAPSHOT: WorkbenchTabsSnapshot = {
  enabled: false,
  closeButtonPosition: DEFAULT_CLOSE_BUTTON_POSITION,
  scopeKey: 'project:none',
  activeTabId: null,
  tabs: [],
}

/** @internal The page channel owns no actor, persistence, navigation or computed tab metadata. */
const createWorkbenchTabsChannel = () => {
  let provider: WorkbenchTabsProvider | undefined
  let unsubscribe: (() => void) | undefined
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const actions: WorkbenchTabsActions = {
    activate: id => provider?.actions.activate(id),
    close: id => provider?.actions.close(id),
    keep: id => provider?.actions.keep(id),
    togglePin: id => provider?.actions.togglePin(id),
    move: (id, index) => provider?.actions.move(id, index),
    closeOthers: id => provider?.actions.closeOthers(id),
    closeToRight: id => provider?.actions.closeToRight(id),
    moveAside: id => provider?.actions.moveAside(id) ?? false,
    open: (target, newTab, title) => provider?.actions.open(target, newTab, title),
    newTab: () => provider?.actions.newTab(),
    newThread: () => provider?.actions.newThread?.(),
    renameThread: (sessionId, title) => provider?.actions.renameThread(sessionId, title) ?? Promise.reject(new Error('Main tabs provider unavailable.')),
  }
  return {
    getSnapshot: (): WorkbenchTabsSnapshot => provider?.getSnapshot() ?? EMPTY_SNAPSHOT,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    actions,
    renderStart: (): ReactNode => provider?.renderStart() ?? null,
    renderTabMenu: (tabId: string, onRename: () => void, onStatus?: (message: string) => void): ReactNode =>
      provider?.renderTabMenu?.(tabId, onRename, onStatus) ?? null,
    label: (key: 'newTab' | 'pinned' | 'running' | 'needsYou' | 'unread' | 'renameThread' | 'renameFailed' | 'closeTab', title?: string): string =>
      provider?.label?.(key, title) ?? '',
    /** A replacement owns the channel immediately; a stale HMR disposer cannot clear it. */
    connect: (next: WorkbenchTabsProvider): (() => void) => {
      unsubscribe?.()
      provider = next
      unsubscribe = next.subscribe(notify)
      notify()
      return () => {
        if (provider !== next) return
        unsubscribe?.()
        unsubscribe = undefined
        provider = undefined
        notify()
      }
    },
  }
}

/** Undefined delegates to native mode; false rejects without falling through or closing the actor tab. */
export type WorkbenchTabAsideHandler = (tabId: string) => boolean | undefined

/** Presentation admission only: the frame owner moves the existing tab occurrence, never its actor state. */
const createWorkbenchTabAsideChannel = () => {
  let owner: { readonly handler: WorkbenchTabAsideHandler } | undefined
  return {
    request: (tabId: string): boolean | undefined => owner?.handler(tabId),
    connect: (handler: WorkbenchTabAsideHandler): (() => void) => {
      const registration = { handler }
      owner = registration
      return () => {
        if (owner === registration) owner = undefined
      }
    },
  }
}

declare global {
  /** One docking admission owner per page; separate from semantic-provider publication for old-bundle tolerance. */
  var dshfilesWorkbenchTabAsideV1: ReturnType<typeof createWorkbenchTabAsideChannel> | undefined
  /** One channel per page even when public modules are duplicated across client bundles. */
  var dshfilesWorkbenchTabsV1: ReturnType<typeof createWorkbenchTabsChannel> | undefined
}

const channel = () => (globalThis.dshfilesWorkbenchTabsV1 ??= createWorkbenchTabsChannel())

/** Read and drive the existing main-tabs actor. Snapshot adoption MUST NOT call actions. */
export const workbenchTabs = (): WorkbenchTabsProvider => channel()

/** @internal Only main-tabs publishes; consumers use workbenchTabs(). */
export const connectWorkbenchTabs = (provider: WorkbenchTabsProvider): (() => void) => channel().connect(provider)

const asideChannel = () => (globalThis.dshfilesWorkbenchTabAsideV1 ??= createWorkbenchTabAsideChannel())

/** One owned presentation-admission boundary; semantic tab publication stays independent. */
export class WorkbenchTabDocking {
  /** Offer an explicit Move-aside gesture before native independent-pane fallback. */
  static request(tabId: string): boolean | undefined {
    return asideChannel().request(tabId)
  }

  /** The frame owns admission; stale plugin/HMR cleanup cannot clear a replacement. */
  static register(handler: WorkbenchTabAsideHandler): () => void {
    return asideChannel().connect(handler)
  }
}
