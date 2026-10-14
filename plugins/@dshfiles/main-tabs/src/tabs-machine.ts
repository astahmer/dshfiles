import { and, assign, raise, setup } from '@dshfiles/plugin-ui/machine'

/** What the Host's main view can show. */
export type HostTarget = { readonly kind: 'panel'; readonly panelId: string } | { readonly kind: 'thread'; readonly sessionId: string }

/** A tab shows a Host target, or the new-tab page (suggestions of what to open), which only the strip renders. */
export type TabTarget = HostTarget | { readonly kind: 'start' }

export interface Tab {
  readonly id: string
  readonly target: TabTarget
  readonly pinned: boolean
  /** A preview tab is replaced by the next thing opened from outside the strip, VS Code style. */
  readonly preview: boolean
  /** Activation order, for least-recently-used eviction past the tab limit. */
  readonly usedAt: number
}

export interface TabSet {
  readonly tabs: readonly Tab[]
  readonly activeTabId: string | null
}

export type OpenMode = 'preview' | 'new' | 'replace'
export type TabPersistence = 'project' | 'global'

export interface TabPreferences {
  readonly enabled: boolean
  readonly maxTabs: number
  readonly openMode: OpenMode
  readonly persistence: TabPersistence
}

/** A saved tab always shows a Host target: the new-tab page is a moment, not a place, and is never saved. */
export interface PersistedTab extends Omit<Tab, 'target'> {
  readonly target: HostTarget
}

export interface PersistedTabs {
  readonly lastProjectKey: string | null
  readonly sets: Readonly<Record<string, { readonly tabs: readonly PersistedTab[]; readonly activeTabId: string | null }>>
}

export interface TabsPorts {
  /** Show the target in the main view; false when the Host cannot (an unregistered panel). */
  readonly navigate: (target: HostTarget) => boolean
  readonly save: (tabs: PersistedTabs) => void
}

export type TabsEvent =
  | { readonly type: 'host.navigated'; readonly target: HostTarget | null; readonly projectId: string | null }
  | { readonly type: 'tab.new' }
  /** A suggestion picked on the new-tab page: its target takes the page's place; null closes it (New thread, Settings). */
  | { readonly type: 'start.pick'; readonly target: HostTarget | null }
  | { readonly type: 'tab.select'; readonly tabId: string }
  | { readonly type: 'tab.close'; readonly tabId: string }
  | { readonly type: 'tab.closeOthers'; readonly tabId: string }
  | { readonly type: 'tab.closeToRight'; readonly tabId: string }
  | { readonly type: 'tab.togglePin'; readonly tabId: string }
  | { readonly type: 'tab.keep'; readonly tabId: string }
  | { readonly type: 'tab.move'; readonly tabId: string; readonly toIndex: number }
  | { readonly type: 'tab.activateIndex'; readonly index: number }
  | { readonly type: 'tab.cycle'; readonly direction: 1 | -1 }
  | { readonly type: 'preferences.changed'; readonly preferences: TabPreferences }
  | { readonly type: 'threads.missing'; readonly sessionIds: readonly string[] }

interface TabsContext {
  readonly ports: TabsPorts
  readonly preferences: TabPreferences
  readonly sets: Readonly<Record<string, TabSet>>
  readonly lastProjectKey: string | null
  readonly scopeKey: string
  readonly clock: number
  /** What the Host shows now, kept while disabled or waiting for settings so enabling adopts it. */
  readonly hostTarget: HostTarget | null
  readonly hostProjectId: string | null
  readonly hostSeen: boolean
  /** A navigation this machine started; Host reports of anything else are in-between states until it lands. */
  readonly pendingTarget: HostTarget | null
  /** The first Host report after load either restores the saved active tab or opens what the Host shows. */
  readonly restored: boolean
}

interface TabsInput {
  readonly ports: TabsPorts
  readonly persisted: PersistedTabs | null
}

export const DEFAULT_TAB_PREFERENCES: TabPreferences = { enabled: true, maxTabs: 12, openMode: 'preview', persistence: 'project' }

const GLOBAL_KEY = 'global'
const NO_PROJECT_KEY = 'project:none'
/** How long a Host report that disagrees with our own navigation is treated as an in-between state. */
const NAVIGATION_SETTLE_MS = 2_000
const EMPTY_SET: TabSet = { tabs: [], activeTabId: null }

export const START_TAB_ID = 'start'

export const tabIdOf = (target: TabTarget): string => {
  if (target.kind === 'start') return START_TAB_ID
  return target.kind === 'panel' ? `panel:${target.panelId}` : `thread:${target.sessionId}`
}

const sameTarget = (left: HostTarget | null, right: HostTarget | null): boolean =>
  left === null || right === null ? left === right : tabIdOf(left) === tabIdOf(right)

const projectKeyOf = (projectId: string): string => `project:${projectId}`

const scopeKeyFor = (preferences: TabPreferences, lastProjectKey: string | null): string =>
  preferences.persistence === 'global' ? GLOBAL_KEY : (lastProjectKey ?? NO_PROJECT_KEY)

const currentSet = (context: TabsContext): TabSet => context.sets[context.scopeKey] ?? EMPTY_SET

/** Pinned tabs stay a contiguous group at the start; the sort is stable, so each group keeps its order. */
const pinnedFirst = (tabs: readonly Tab[]): Tab[] => [...tabs.filter(tab => tab.pinned), ...tabs.filter(tab => !tab.pinned)]

const evictPastLimit = (set: TabSet, maxTabs: number): TabSet => {
  let tabs = [...set.tabs]
  while (tabs.length > maxTabs) {
    const candidates = tabs.filter(tab => !tab.pinned && tab.id !== set.activeTabId)
    const oldest = candidates.reduce<Tab | undefined>((found, tab) => (found === undefined || tab.usedAt < found.usedAt ? tab : found), undefined)
    if (oldest === undefined) break
    tabs = tabs.filter(tab => tab.id !== oldest.id)
  }
  return { ...set, tabs }
}

const openTarget = (set: TabSet, target: TabTarget, preferences: TabPreferences, usedAt: number): TabSet => {
  const id = tabIdOf(target)
  if (set.tabs.some(tab => tab.id === id)) {
    return { tabs: set.tabs.map(tab => (tab.id === id ? { ...tab, usedAt } : tab)), activeTabId: id }
  }
  const opened: Tab = { id, target, pinned: false, preview: preferences.openMode === 'preview', usedAt }
  const replaced =
    preferences.openMode === 'preview'
      ? set.tabs.find(tab => tab.preview && !tab.pinned)
      : preferences.openMode === 'replace'
        ? set.tabs.find(tab => tab.id === set.activeTabId && !tab.pinned)
        : undefined
  if (replaced !== undefined) {
    return evictPastLimit({ tabs: set.tabs.map(tab => (tab.id === replaced.id ? opened : tab)), activeTabId: id }, preferences.maxTabs)
  }
  const activeIndex = set.tabs.findIndex(tab => tab.id === set.activeTabId)
  const pinnedCount = set.tabs.filter(tab => tab.pinned).length
  const insertAt = activeIndex === -1 ? set.tabs.length : Math.max(activeIndex + 1, pinnedCount)
  const tabs = [...set.tabs.slice(0, insertAt), opened, ...set.tabs.slice(insertAt)]
  return evictPastLimit({ tabs, activeTabId: id }, preferences.maxTabs)
}

/** Remove tabs; when the active one goes, its right neighbour (else the left one) takes over, as in a browser. */
const removeTabs = (set: TabSet, removed: (tab: Tab) => boolean): TabSet => {
  const tabs = set.tabs.filter(tab => !removed(tab))
  const active = set.tabs.find(tab => tab.id === set.activeTabId)
  if (active === undefined || !removed(active)) return { tabs, activeTabId: set.activeTabId }
  const activeIndex = set.tabs.indexOf(active)
  const right = set.tabs.slice(activeIndex + 1).find(tab => !removed(tab))
  const left = set.tabs
    .slice(0, activeIndex)
    .reverse()
    .find(tab => !removed(tab))
  return { tabs, activeTabId: (right ?? left)?.id ?? null }
}

/**
 * The new-tab page gives its place to what was opened from it, or from anywhere else while it was shown; a target that
 * already has a tab is focused there instead.
 */
const replaceStart = (set: TabSet, target: HostTarget, usedAt: number): TabSet => {
  const id = tabIdOf(target)
  if (set.tabs.some(tab => tab.id === id)) {
    return { tabs: set.tabs.flatMap(tab => (tab.id === START_TAB_ID ? [] : [tab.id === id ? { ...tab, usedAt } : tab])), activeTabId: id }
  }
  const opened: Tab = { id, target, pinned: false, preview: false, usedAt }
  return { tabs: set.tabs.map(tab => (tab.id === START_TAB_ID ? opened : tab)), activeTabId: id }
}

/** Open the new-tab page at the end of the strip, or focus it when it is already open. */
const openStart = (set: TabSet, usedAt: number, maxTabs: number): TabSet => {
  if (set.tabs.some(tab => tab.id === START_TAB_ID)) {
    return { tabs: set.tabs.map(tab => (tab.id === START_TAB_ID ? { ...tab, usedAt } : tab)), activeTabId: START_TAB_ID }
  }
  const opened: Tab = { id: START_TAB_ID, target: { kind: 'start' }, pinned: false, preview: false, usedAt }
  return evictPastLimit({ tabs: [...set.tabs, opened], activeTabId: START_TAB_ID }, maxTabs)
}

const moveTab = (set: TabSet, tabId: string, toIndex: number): TabSet => {
  const tab = set.tabs.find(candidate => candidate.id === tabId)
  if (tab === undefined) return set
  const pinnedCount = set.tabs.filter(candidate => candidate.pinned).length
  const rest = set.tabs.filter(candidate => candidate.id !== tabId)
  const [low, high] = tab.pinned ? [0, pinnedCount - 1] : [pinnedCount, rest.length]
  const index = Math.min(Math.max(toIndex, low), high)
  return { ...set, tabs: [...rest.slice(0, index), { ...tab, preview: false }, ...rest.slice(index)] }
}

const withSet = (context: TabsContext, set: TabSet): Pick<TabsContext, 'sets'> => ({ sets: { ...context.sets, [context.scopeKey]: set } })

const activeTarget = (context: TabsContext): TabTarget | null =>
  currentSet(context).tabs.find(tab => tab.id === currentSet(context).activeTabId)?.target ?? null

const persisted = (context: TabsContext): PersistedTabs => ({
  lastProjectKey: context.lastProjectKey,
  sets: Object.fromEntries(
    Object.entries(context.sets).map(([key, set]) => [
      key,
      {
        tabs: set.tabs.flatMap(tab => (tab.target.kind === 'start' ? [] : [{ ...tab, target: tab.target }])),
        activeTabId: set.activeTabId === START_TAB_ID ? null : set.activeTabId,
      },
    ]),
  ),
})

/**
 * Owns the main-view tab strip: which tabs exist (per project or globally), their order, pins and preview flag, the
 * active one, and their persistence. The Host's main view is the truth for what is shown; this machine follows it and
 * asks it to navigate when the user picks a tab, ignoring the Host's in-between reports until that navigation lands.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const tabsMachine = setup({
  types: {
    context: {} as TabsContext,
    events: {} as TabsEvent,
    input: {} as TabsInput,
  },
  actions: {
    persist: ({ context }) => context.ports.save(persisted(context)),
    navigateToActive: assign(({ context }) => {
      const target = activeTarget(context)
      if (target === null || target.kind === 'start' || sameTarget(target, context.hostTarget)) return { pendingTarget: null }
      return { pendingTarget: context.ports.navigate(target) ? target : null }
    }),
    followHost: assign(({ context, event }) => {
      if (event.type !== 'host.navigated') return {}
      const projectChanged = event.projectId !== null && projectKeyOf(event.projectId) !== context.lastProjectKey
      const lastProjectKey = event.projectId === null ? context.lastProjectKey : projectKeyOf(event.projectId)
      const scopeKey = scopeKeyFor(context.preferences, lastProjectKey)
      const scoped = {
        ...context,
        lastProjectKey,
        scopeKey,
        hostTarget: event.target,
        hostProjectId: event.projectId,
        hostSeen: true,
        pendingTarget: null,
        restored: true,
      }
      const set = currentSet(scoped)
      const startShown = set.activeTabId === START_TAB_ID
      if (event.target === null) {
        // Nothing is shown (the New thread screen): no tab is active, unless this is the first report and a tab waits.
        const shown = startShown ? removeTabs(set, tab => tab.id === START_TAB_ID) : set
        return { ...scoped, ...withSet(scoped, { ...shown, activeTabId: context.restored || projectChanged || startShown ? null : set.activeTabId }) }
      }
      const clock = context.clock + 1
      const next = startShown ? replaceStart(set, event.target, clock) : openTarget(set, event.target, context.preferences, clock)
      return { ...scoped, clock, ...withSet(scoped, next) }
    }),
    recordHost: assign(({ event }) => (event.type === 'host.navigated' ? { hostTarget: event.target, hostProjectId: event.projectId, hostSeen: true } : {})),
    applyPreferences: assign(({ context, event }) => {
      if (event.type !== 'preferences.changed') return {}
      const scopeKey = scopeKeyFor(event.preferences, context.lastProjectKey)
      const scoped = { ...context, preferences: event.preferences, scopeKey }
      return { preferences: event.preferences, scopeKey, ...withSet(scoped, evictPastLimit(currentSet(scoped), event.preferences.maxTabs)) }
    }),
    // Adopt what the Host shows right now, as if it had just navigated there.
    adoptHost: raise(({ context }) => ({ type: 'host.navigated' as const, target: context.hostTarget, projectId: context.hostProjectId })),
  },
  guards: {
    enabled: ({ event }) => event.type === 'preferences.changed' && event.preferences.enabled,
    hostSeen: ({ context }) => context.hostSeen,
    disabled: ({ event }) => event.type === 'preferences.changed' && !event.preferences.enabled,
    landsPending: ({ context, event }) => event.type === 'host.navigated' && sameTarget(event.target, context.pendingTarget),
    restoresSavedTab: ({ context, event }) =>
      event.type === 'host.navigated' && event.target === null && !context.restored && currentSet(context).activeTabId !== null,
  },
  delays: { settle: NAVIGATION_SETTLE_MS },
}).createMachine({
  id: 'mainTabs',
  context: ({ input }) => {
    const lastProjectKey = input.persisted?.lastProjectKey ?? null
    const sets = input.persisted?.sets ?? {}
    const clock = Math.max(0, ...Object.values(sets).flatMap(set => set.tabs.map(tab => tab.usedAt)))
    return {
      ports: input.ports,
      preferences: DEFAULT_TAB_PREFERENCES,
      sets,
      lastProjectKey,
      scopeKey: scopeKeyFor(DEFAULT_TAB_PREFERENCES, lastProjectKey),
      clock,
      hostTarget: null,
      hostProjectId: null,
      hostSeen: false,
      pendingTarget: null,
      restored: false,
    }
  },
  // Settings are read by a component after boot; until the first read the machine only records what the Host shows.
  initial: 'gate',
  states: {
    gate: {
      on: {
        'host.navigated': { actions: 'recordHost' },
        'preferences.changed': [
          { guard: and(['enabled', 'hostSeen']), target: 'on', actions: ['applyPreferences', 'adoptHost'] },
          { guard: 'enabled', target: 'on', actions: 'applyPreferences' },
          { target: 'off', actions: 'applyPreferences' },
        ],
      },
    },
    off: {
      on: {
        'host.navigated': { actions: 'recordHost' },
        'preferences.changed': [
          { guard: and(['enabled', 'hostSeen']), target: 'on', actions: ['applyPreferences', assign({ restored: true }), 'adoptHost'] },
          { guard: 'enabled', target: 'on', actions: ['applyPreferences', assign({ restored: true })] },
          { actions: 'applyPreferences' },
        ],
      },
    },
    on: {
      initial: 'following',
      on: {
        'preferences.changed': [
          { guard: 'disabled', target: 'off', actions: assign(({ event }) => ({ preferences: event.preferences, pendingTarget: null })) },
          { actions: ['applyPreferences', 'persist'] },
        ],
        'tab.select': {
          target: '.navigating',
          actions: [
            assign(({ context, event }) => {
              const set = currentSet(context)
              if (!set.tabs.some(tab => tab.id === event.tabId)) return {}
              const clock = context.clock + 1
              return {
                clock,
                ...withSet(context, { tabs: set.tabs.map(tab => (tab.id === event.tabId ? { ...tab, usedAt: clock } : tab)), activeTabId: event.tabId }),
              }
            }),
            'navigateToActive',
            'persist',
          ],
        },
        'tab.new': {
          actions: [
            assign(({ context }) => {
              const clock = context.clock + 1
              return { clock, ...withSet(context, openStart(currentSet(context), clock, context.preferences.maxTabs)) }
            }),
            'persist',
          ],
        },
        'start.pick': {
          target: '.navigating',
          actions: [
            assign(({ context, event }) => {
              const set = currentSet(context)
              if (!set.tabs.some(tab => tab.id === START_TAB_ID)) return {}
              const clock = context.clock + 1
              if (event.target !== null) return { clock, ...withSet(context, replaceStart(set, event.target, clock)) }
              // Closing the page reveals what the Host still shows underneath; its tab, if any, is active again.
              const remaining = set.tabs.filter(tab => tab.id !== START_TAB_ID)
              const hostTabId = context.hostTarget === null ? null : tabIdOf(context.hostTarget)
              return withSet(context, { tabs: remaining, activeTabId: remaining.some(tab => tab.id === hostTabId) ? hostTabId : null })
            }),
            'navigateToActive',
            'persist',
          ],
        },
        'tab.activateIndex': {
          guard: ({ context, event }) => currentSet(context).tabs.length > 0 && event.index < currentSet(context).tabs.length,
          actions: raise(({ context, event }) => {
            const tabs = currentSet(context).tabs
            return { type: 'tab.select' as const, tabId: (event.index < 0 ? tabs.at(-1) : tabs[event.index])?.id ?? '' }
          }),
        },
        'tab.cycle': {
          guard: ({ context }) => currentSet(context).tabs.length > 0,
          actions: raise(({ context, event }) => {
            const set = currentSet(context)
            const activeIndex = set.tabs.findIndex(tab => tab.id === set.activeTabId)
            const next = set.tabs[(Math.max(activeIndex, 0) + event.direction + set.tabs.length) % set.tabs.length]
            return { type: 'tab.select' as const, tabId: next?.id ?? '' }
          }),
        },
        'tab.close': {
          target: '.navigating',
          actions: [
            assign(({ context, event }) =>
              withSet(
                context,
                removeTabs(currentSet(context), tab => tab.id === event.tabId),
              ),
            ),
            'navigateToActive',
            'persist',
          ],
        },
        'tab.closeOthers': {
          target: '.navigating',
          actions: [
            assign(({ context, event }) => {
              const set = currentSet(context)
              if (!set.tabs.some(tab => tab.id === event.tabId)) return {}
              return withSet(context, { tabs: set.tabs.filter(tab => tab.pinned || tab.id === event.tabId), activeTabId: event.tabId })
            }),
            'navigateToActive',
            'persist',
          ],
        },
        'tab.closeToRight': {
          target: '.navigating',
          actions: [
            assign(({ context, event }) => {
              const set = currentSet(context)
              const index = set.tabs.findIndex(tab => tab.id === event.tabId)
              if (index === -1) return {}
              const next = removeTabs(set, tab => !tab.pinned && set.tabs.indexOf(tab) > index)
              return withSet(context, next.tabs.some(tab => tab.id === set.activeTabId) ? next : { ...next, activeTabId: event.tabId })
            }),
            'navigateToActive',
            'persist',
          ],
        },
        'tab.togglePin': {
          actions: [
            assign(({ context, event }) => {
              const set = currentSet(context)
              const tabs = set.tabs.map(tab => (tab.id === event.tabId && tab.id !== START_TAB_ID ? { ...tab, pinned: !tab.pinned, preview: false } : tab))
              return withSet(context, { ...set, tabs: pinnedFirst(tabs) })
            }),
            'persist',
          ],
        },
        'tab.keep': {
          actions: [
            assign(({ context, event }) => {
              const set = currentSet(context)
              return withSet(context, { ...set, tabs: set.tabs.map(tab => (tab.id === event.tabId ? { ...tab, preview: false } : tab)) })
            }),
            'persist',
          ],
        },
        'tab.move': {
          actions: [assign(({ context, event }) => withSet(context, moveTab(currentSet(context), event.tabId, event.toIndex))), 'persist'],
        },
        'threads.missing': {
          actions: [
            assign(({ context, event }) => {
              const missing = new Set(event.sessionIds)
              const gone = (tab: Tab): boolean => tab.target.kind === 'thread' && missing.has(tab.target.sessionId)
              const sets = Object.fromEntries(Object.entries(context.sets).map(([key, set]) => [key, removeTabs(set, gone)]))
              return { sets }
            }),
            'persist',
          ],
        },
      },
      states: {
        following: {
          on: {
            'host.navigated': [
              {
                guard: 'restoresSavedTab',
                target: 'navigating',
                actions: [assign({ restored: true }), 'recordHost', 'navigateToActive'],
              },
              { actions: ['followHost', 'persist'] },
            ],
          },
        },
        navigating: {
          always: { guard: ({ context }) => context.pendingTarget === null, target: 'following' },
          after: { settle: { target: 'following', actions: assign({ pendingTarget: null }) } },
          on: {
            'host.navigated': [{ guard: 'landsPending', target: 'following', actions: ['followHost', 'persist'] }, { actions: 'recordHost' }],
          },
        },
      },
    },
  },
})
