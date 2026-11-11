import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ShortcutBinding, ShortcutCommand, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createApiClient, defineClient, runHostCommand, useRegistry, useSettings } from '@dshfiles/dshx/client'
import { openInteraction, redactIdentifier, startInteraction } from '@dshfiles/dshx/tracing/client'
import type { BeforeMainOwnerProps } from '@dshfiles/frame-layout/regions'
import { useThreadAttention } from '@dshfiles/thread-sidebar/attention-client'
import { HostSnapshotsModel } from '@dshfiles/thread-sidebar/snapshots'
import { DestinationSections, KNOWN_SECTIONS } from '@dshfiles/thread-sidebar/destinations'
import { threadSidebarThreadDirectoriesApi, useThreadDirectories, WorkspacePaths, type ThreadDirectories } from '@dshfiles/thread-sidebar/thread-directories'
import { PanelTitles } from '@dshfiles/workbench/panel-titles'
import { MessageSquareIcon, MessageSquarePlusIcon, PanelsTopLeftIcon, SettingsIcon } from '@dshfiles/plugin-ui/icons'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { Effect, Fiber, Schema } from 'effect'
import { createThreadWorkspaceResolver, readHostView } from './host-target.js'
import { ProjectNames } from './project-names.js'
import { MAIN_TABS_LOCALE_NAMESPACE, mainTabsLocale } from './locales.js'
import { mainTabsSettings } from './settings.js'
import { PanelIcon, StartPage, type StartSection } from './start-page.js'
import { OPEN_PANEL_TAB_EVENT, PANEL_TAB_TITLE_EVENT, PanelTabs } from './panel-tabs.js'
import { panelShortcut, recentThreads } from './start-suggestions.js'
import { PanelTitlesModel } from './panel-titles.js'
import { TabMenuItems } from './tab-menu-items.js'
import { effectiveTabPreferences } from './tab-preferences-policy.js'
import { installThreadLinkClicks } from './thread-link-click.js'
import { TabStrip, threadTabStatus, type TabView } from './tab-strip.js'
import { DEFAULT_TAB_PREFERENCES, START_TAB_ID, tabIdOf, tabsMachine, type TabPreferences, type TabsEvent } from './tabs-machine.js'
import { DEFAULT_CLOSE_BUTTON_POSITION, type HostTarget } from '@dshfiles/workbench/tabs'
import { connectWorkbenchTabs, WorkbenchTabDocking, type WorkbenchTab } from './workbench-tabs.js'
import { createWorkbenchTabsActions } from './workbench-tab-actions.js'
import { createWorkbenchTabsPublication } from './workbench-tabs-publication.js'
import { createMainTabsService } from './main-tabs-service.js'
import { MainTabs } from './tabs-contract.js'
import { requestThreadAside } from './thread-aside.js'
import { requestPanelAside } from './panel-aside.js'
import { saveTabs, storedTabs } from './tabs-storage.js'
import './client.css'

const THREAD_TAB_KEEP_EVENT = 'dshfiles:main-tabs:keep-thread'
const THREAD_TAB_FOCUS_EVENT = 'dshfiles:main-tabs:focus-thread'
const threadTabKeepRequestSchema = Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)) })

const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)

/** "dshfiles-multi-host-thread" → "Multi host thread", for a main panel without a sidebar entry to name it. */
const panelTitleFallback = (panelId: string): string => {
  const words = panelId.replace(/^dshfiles-/u, '').replaceAll(/[-_.]+/gu, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const STRIP_MISSING_AFTER_MS = 3_000
const STRIP_MISSING_WARNING =
  'main-tabs: the tab strip cannot mount: the frame did not render its shell.beforeMain seat within 3 s. Tabs still follow the main view and the tab shortcuts still work. Enable @dshfiles/frame-layout (or update it) in the profile, then reload.'

/**
 * Settings is a Host modal. Its command (`settings.open`) runs through the
 * Shortcuts registry, which is what the Desktop menu uses; the launcher trigger
 * below is only a fallback, because a Host whose `settings.launcher` slot is
 * taken by the account menu no longer renders a plain Settings button.
 */
const SETTINGS_TRIGGER_SELECTOR = '[data-slot="settings.launcher"] button[aria-haspopup="dialog"]'
const SETTINGS_COMMAND_ID = 'settings.open'

/** While the new-tab page shows, the main panel under it stays mounted but hidden, keeping a thread's scroll and state. */
const useHiddenMainPanel = (holdMainHidden: BeforeMainOwnerProps['holdMainHidden'], hidden: boolean): void => {
  useLayoutEffect(() => (hidden ? holdMainHidden() : undefined), [hidden, holdMainHidden])
}

/**
 * Another plugin asks for a thread through this cancelable window event; a cancelled dispatch means a tab took it, so
 * the caller falls back to `uiWorkspace.openSession` only when this plugin is absent or switched off.
 */
const OPEN_THREAD_EVENT = 'dshfiles:open-thread'
const openThreadRequestSchema = Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)), newTab: Schema.Boolean })
const REPLACE_THREAD_TAB_EVENT = 'dshfiles:replace-thread-tab'
const replaceThreadTabRequestSchema = Schema.Struct({
  sourceSessionId: Schema.String.check(Schema.isMinLength(1)),
  sessionId: Schema.String.check(Schema.isMinLength(1)),
})

export default defineClient({
  name: '@dshfiles/main-tabs',
  locales: [mainTabsLocale],
  inject: ['slots', 'layout', 'sessions', 'uiSession', 'workspaces', 'uiWorkspace', 'shortcuts', 'remote', 'remote.session'],
  setup(ctx, decorate, metadata) {
    const translate = ctx.locale.bind(MAIN_TABS_LOCALE_NAMESPACE)
    const mainSurface = ctx.get('mainSurface')

    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)

    let shownSessionId: string | undefined
    const navigate = (target: HostTarget): boolean => {
      if (target.kind === 'panel') {
        if (!isMainPanelId(target.panelId)) return false
        // The Host shows one panel per key, so the scope is announced to the panel before it is selected.
        PanelTabs.announce(target)
        const opening = startInteraction('panel open', { attributes: { 'dshx.main_tabs.panel': redactIdentifier(target.panelId) } })
        ctx.layout.selectPanel(target.panelId)
        opening.endAfterPaint()
        return true
      }
      const sessionId = ctx.sessions.list.getSnapshot().ids.find(id => id === target.sessionId)
      if (sessionId === undefined) return false
      // A sidebar click already opened the interaction and reaches here through the open-thread request.
      if (shownSessionId !== sessionId && openInteraction('thread switch') === undefined)
        startInteraction('thread switch', { attributes: { 'dshx.thread.source': 'main-tabs' } })
      ctx.uiWorkspace.openSession(sessionId)
      return true
    }

    const renameThread = async (sessionId: string, title: string): Promise<void> => {
      const target = ctx.sessions.list.getSnapshot().ids.find(id => id === sessionId)
      if (target === undefined) throw new Error('the thread is not listed')
      const result = await ctx.remote.session.rename({ sessionId: target, title })
      if (!result.ok) throw new Error(result.error.message)
    }

    const actor = createActor(tabsMachine, {
      input: { ports: { navigate, save: saveTabs, leavePanel: () => ctx.layout.selectPanel(null) }, persisted: storedTabs.get() },
    })
    ctx.effect(() => {
      actor.start()
      return () => actor.stop()
    }, 'main-tabs: tabs machine')

    /** Open a listed thread in the strip; false means nothing took it and the caller keeps its own behavior. */
    const requestThreadTab = (sessionId: string, newTab: boolean): boolean => {
      if (!actor.getSnapshot().matches('on')) return false
      const listed = ctx.sessions.list.getSnapshot().ids.find(id => id === sessionId)
      if (listed === undefined) return false
      actor.send({ type: 'tab.open', target: { kind: 'thread', sessionId: listed }, newTab })
      return true
    }

    // A same-origin thread link is a tab, not a document load: inside an installed PWA loading the app again looks
    // like the current page reloading, which is what a clicked thread link used to do.
    ctx.effect(
      () => installThreadLinkClicks({ document, origin: window.location.origin, openThread: sessionId => requestThreadTab(sessionId, true) }),
      'main-tabs: open a clicked thread link in a tab',
    )

    ctx.effect(() => {
      const onOpenThread = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const decoded = Schema.decodeUnknownResult(openThreadRequestSchema)(event.detail)
        if (decoded._tag === 'Failure' || !requestThreadTab(decoded.success.sessionId, decoded.success.newTab)) return
        event.preventDefault()
      }
      const onReplaceThreadTab = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const decoded = Schema.decodeUnknownResult(replaceThreadTabRequestSchema, { onExcessProperty: 'error' })(event.detail)
        if (decoded._tag === 'Failure' || !actor.getSnapshot().matches('on')) return
        const snapshot = actor.getSnapshot()
        const set = snapshot.context.sets[snapshot.context.scopeKey]
        const sourceId = tabIdOf({ kind: 'thread', sessionId: decoded.success.sourceSessionId })
        if (!set?.tabs.some(tab => tab.id === sourceId) || !ctx.sessions.list.getSnapshot().ids.some(id => id === decoded.success.sessionId)) return
        event.preventDefault()
        actor.send({ type: 'thread.replace', sourceSessionId: decoded.success.sourceSessionId, sessionId: decoded.success.sessionId })
      }
      window.addEventListener(OPEN_THREAD_EVENT, onOpenThread)
      window.addEventListener(REPLACE_THREAD_TAB_EVENT, onReplaceThreadTab)
      return () => {
        window.removeEventListener(OPEN_THREAD_EVENT, onOpenThread)
        window.removeEventListener(REPLACE_THREAD_TAB_EVENT, onReplaceThreadTab)
      }
    }, 'main-tabs: open a thread for another plugin')

    ctx.effect(() => {
      const keepThreadTab = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const decoded = Schema.decodeUnknownResult(threadTabKeepRequestSchema, { onExcessProperty: 'error' })(event.detail)
        if (decoded._tag === 'Failure') return
        actor.send({ type: 'thread.keep', sessionId: decoded.success.sessionId })
      }
      window.addEventListener(THREAD_TAB_KEEP_EVENT, keepThreadTab)
      return () => window.removeEventListener(THREAD_TAB_KEEP_EVENT, keepThreadTab)
    }, 'main-tabs: keep double-clicked sidebar threads')

    ctx.effect(() => {
      const openPanelTab = (event: Event): void => {
        const request = PanelTabs.readRequest(event)
        if (request === undefined || !actor.getSnapshot().matches('on')) return
        const target: HostTarget = { kind: 'panel', panelId: request.panelId, scope: request.scope }
        const opened = { type: 'tab.open' as const, target, newTab: true, title: request.title }
        actor.send(request.title === undefined ? { type: 'tab.open', target, newTab: true } : opened)
      }
      const retitle = (event: Event): void => {
        const request = PanelTabs.readTitle(event)
        if (request === undefined) return
        actor.send({ type: 'tab.title', tabId: PanelTabs.tabId(request.panelId, request.scope), title: request.title })
      }
      window.addEventListener(OPEN_PANEL_TAB_EVENT, openPanelTab)
      window.addEventListener(PANEL_TAB_TITLE_EVENT, retitle)
      return () => {
        window.removeEventListener(OPEN_PANEL_TAB_EVENT, openPanelTab)
        window.removeEventListener(PANEL_TAB_TITLE_EVENT, retitle)
      }
    }, 'main-tabs: panel tabs with their own scope')

    ctx.effect(() => {
      let reported = ''
      // A custom threads directory is only known to the Host's VCS providers: ask once per project set.
      let threadDirectories: ThreadDirectories = new Map()
      let askedProjectPaths = ''
      let directoriesRequest: Fiber.Fiber<void> | undefined
      const refreshThreadDirectories = (workspaces: readonly { readonly path: string }[]): void => {
        const projectPaths = [...new Set(WorkspacePaths.projects({ rows: workspaces }).map(workspace => workspace.path))].sort()
        const key = projectPaths.join('\n')
        if (key === askedProjectPaths || projectPaths.length === 0) return
        askedProjectPaths = key
        if (directoriesRequest !== undefined) Effect.runFork(Fiber.interrupt(directoriesRequest))
        directoriesRequest = Effect.runFork(
          Effect.tryPromise(signal => createApiClient(ctx, threadSidebarThreadDirectoriesApi).list({ projectPaths }, { signal })).pipe(
            Effect.map(reportedDirectories => {
              threadDirectories = WorkspacePaths.threadDirectoriesOf(reportedDirectories.directories)
              report()
            }),
            Effect.ignore,
          ),
        )
      }
      const report = (): void => {
        const sessions = ctx.sessions.list.getSnapshot()
        // Before the list arrives, "no Session in the main view" is not yet a fact.
        if (sessions.phase !== 'ready') return
        const workspaces = HostSnapshotsModel.selectStableWorkspaceItems(ctx.workspaces.list.getSnapshot().items)
        refreshThreadDirectories(workspaces)
        const view = readHostView({
          activePanelId: ctx.layout.panelInfo.getSnapshot().activePanelId,
          currentSessionId: ctx.uiSession.adapter.current.getSnapshot().key,
          byId: sessions.byId,
          workspaces,
          threadDirectories,
        })
        // The Host cannot name a scope, so a scoped tab on screen reports itself; otherwise the panel is bare.
        const snapshot = actor.getSnapshot()
        const activeSet = snapshot.context.sets[snapshot.context.scopeKey]
        const activeTab = activeSet?.tabs.find(tab => tab.id === activeSet.activeTabId)
        const target = PanelTabs.visibleTarget(view.target, activeTab?.target ?? null)
        shownSessionId = view.target?.kind === 'thread' ? view.target.sessionId : undefined
        const key = `${target === null ? '' : tabIdOf(target)}|${view.projectId ?? ''}`
        if (key !== reported) {
          reported = key
          actor.send({ type: 'host.navigated', target, projectId: view.projectId })
        }
        const missing = Object.values(actor.getSnapshot().context.sets)
          .flatMap(set => set.tabs)
          .flatMap(tab => (tab.target.kind === 'thread' && !Object.hasOwn(sessions.byId, tab.target.sessionId) ? [tab.target.sessionId] : []))
        if (missing.length > 0) actor.send({ type: 'threads.missing', sessionIds: [...new Set(missing)] })
      }
      const disposers = [
        ctx.layout.panelInfo.subscribe(report),
        ctx.sessions.list.subscribe(report),
        ctx.workspaces.list.subscribe(report),
        ctx.uiSession.adapter.current.subscribe(report),
      ]
      report()
      return () => {
        if (directoriesRequest !== undefined) Effect.runFork(Fiber.interrupt(directoriesRequest))
        disposers.forEach(dispose => dispose())
      }
    }, 'main-tabs: follow the main view')

    let focusThreadInSidebar = true
    let clearSelectedAttention: ((sessionId: string) => void) | undefined
    const selectThreadTab = (tabId: string): void => {
      const snapshot = actor.getSnapshot()
      const selected = snapshot.context.sets[snapshot.context.scopeKey]?.tabs.find(tab => tab.id === tabId)
      if (selected?.target.kind !== 'thread') return
      clearSelectedAttention?.(selected.target.sessionId)
      if (focusThreadInSidebar) window.dispatchEvent(new CustomEvent(THREAD_TAB_FOCUS_EVENT, { detail: { sessionId: selected.target.sessionId } }))
    }
    const sendStripEvent = (event: TabsEvent): void => {
      if (event.type === 'tab.new') ctx.layout.beginNavigation()
      actor.send(event)
      if (event.type === 'tab.select') selectThreadTab(event.tabId)
    }
    const tabsEnabled = (): boolean => actor.getSnapshot().matches('on')
    const currentSet = () => {
      const snapshot = actor.getSnapshot()
      return snapshot.context.sets[snapshot.context.scopeKey]
    }
    const workbenchActions = createWorkbenchTabsActions({
      enabled: tabsEnabled,
      currentSet,
      send: sendStripEvent,
      reselect: selectThreadTab,
      dockAside: WorkbenchTabDocking.request,
      threadAside: requestThreadAside,
      panelAside: requestPanelAside,
      renameThread,
      startSession: () => ctx.uiWorkspace.startSession(),
    })
    const publication = createWorkbenchTabsPublication(
      workbenchActions,
      {
        label: (key, title) => (key === 'closeTab' && title !== undefined ? translate('close', { title }) : translate(key)),
        renderTabMenu: (tabId, onRename, onStatus) => {
          const snapshot = publication.provider.getSnapshot()
          const tab = snapshot.tabs.find(candidate => candidate.id === tabId)
          return tab === undefined ? null : (
            <TabMenuItems
              tab={tab}
              tabs={snapshot.tabs}
              send={sendStripEvent}
              t={translate}
              onRename={onRename}
              onStatus={onStatus}
              moveAside={workbenchActions.moveAside}
            />
          )
        },
      },
      () => ctx.uiSession.adapter.current.getSnapshot().key,
    )
    ctx.effect(() => connectWorkbenchTabs(publication.provider), 'main-tabs: workbench semantics provider')
    metadata?.plugin?.provide(
      MainTabs,
      createMainTabsService({
        provider: publication.provider,
        enabled: tabsEnabled,
        currentSet,
        isListedThread: sessionId => ctx.sessions.list.getSnapshot().ids.some(id => id === sessionId),
        canReopen: () => actor.getSnapshot().can({ type: 'tab.reopenClosed' }),
        send: event => actor.send(event),
      }),
    )

    // Free-docking tabs (the workbench) get the same page names as the strip: the destination section labels.
    ctx.effect(() => {
      const releases = PanelTitlesModel.destinationTitles([]).map(title => metadata?.plugin?.add(PanelTitles, title) ?? (() => {}))
      return () => releases.forEach(release => release())
    }, 'main-tabs: destination tab titles for the workbench')

    const subscribeMainSurface = (listener: () => void): (() => void) => mainSurface?.subscribe(listener) ?? (() => undefined)
    const mainSurfaceMode = () => mainSurface?.mode() ?? 'native'
    const subscribeActor = (listener: () => void): (() => void) => {
      const subscription = actor.subscribe(listener)
      return () => subscription.unsubscribe()
    }
    const subscribePanels = (listener: () => void): (() => void) => {
      const disposers = [ctx.slots.subscribe('main', listener), ctx.slots.subscribe('sidebar.panellist', listener), ctx.locale.subscribe(listener)]
      return () => disposers.forEach(dispose => dispose())
    }
    const panelsVersion = (): string => `${ctx.slots.getVersion('main')}:${ctx.slots.getVersion('sidebar.panellist')}:${ctx.locale.getLocale().revision}`
    const subscribeCatalog = (listener: () => void): (() => void) => ctx.shortcuts.catalog.subscribe(listener)
    const catalogSnapshot = () => ctx.shortcuts.catalog.getSnapshot()

    // Startup self-check: an older or stock frame has no seat above the main panel, so the strip would never render.
    let stripSeatRendered = false
    ctx.effect(() => {
      const timer = setTimeout(() => {
        if (!stripSeatRendered) console.warn(STRIP_MISSING_WARNING)
      }, STRIP_MISSING_AFTER_MS)
      return () => clearTimeout(timer)
    }, 'main-tabs: strip seat self-check')

    ctx.slots.inject('shell.beforeMain', () =>
      ctx.slots.register(
        { name: 'shell.beforeMain', id: 'dshfiles-main-tabs', order: 10, locale: MAIN_TABS_LOCALE_NAMESPACE },
        decorate(props => {
          useEffect(() => {
            stripSeatRendered = true
          }, [])
          const settings = useSettings(mainTabsSettings)
          const closeButtonPosition = settings.value?.closeButtonPosition ?? DEFAULT_CLOSE_BUTTON_POSITION
          const savedPreferences: TabPreferences | null =
            settings.value !== undefined ? settings.value : settings.status === 'loading' && settings.error === null ? null : DEFAULT_TAB_PREFERENCES
          const mode = useSyncExternalStore(subscribeMainSurface, mainSurfaceMode)
          const preferences = useMemo(() => (savedPreferences === null ? null : effectiveTabPreferences(savedPreferences, mode)), [savedPreferences, mode])
          useEffect(() => {
            focusThreadInSidebar = settings.value?.focusThreadInSidebar ?? true
            if (preferences !== null) actor.send({ type: 'preferences.changed', preferences })
          }, [preferences, settings.value?.focusThreadInSidebar])

          const snapshot = useSyncExternalStore(subscribeActor, () => actor.getSnapshot())
          // Observe the same default binding the native Conversation renders,
          // even while a tool is the active semantic tab. No selection is inferred.
          useSyncExternalStore(ctx.uiSession.adapter.current.subscribe, () => ctx.uiSession.adapter.current.getSnapshot().key)
          // Re-render when panels register or the locale changes; the ledger reads below are cheap.
          const panelVersion = useSyncExternalStore(subscribePanels, panelsVersion)
          const registeredPanels = new Set(ctx.slots.entriesOfSlot('main').flatMap(entry => entry.options.key ?? []))
          const contributedSections = useRegistry(DestinationSections)
          const titles = useMemo(() => PanelTitlesModel.destinationTitles(contributedSections), [contributedSections])
          useEffect(() => {
            const contributed = PanelTitlesModel.destinationTitles(contributedSections).slice(KNOWN_SECTIONS.length)
            const releases = contributed.map(title => metadata?.plugin?.add(PanelTitles, title) ?? (() => {}))
            return () => releases.forEach(release => release())
          }, [contributedSections])
          // Tab titles name the page, not the plugin: a destination section's label, else the label without "Plugin: ".
          const panelLabels = new Map(
            ctx.slots.entriesOfSlot('sidebar.panellist').flatMap(entry => {
              const id = entry.options.id
              const title = id === undefined ? undefined : PanelTitlesModel.titleOf(id, resolveSlotLabel(entry.options.label), titles)
              return id === undefined || title === undefined ? [] : [[id, title] as const]
            }),
          )
          const byId = props.useSessions(HostSnapshotsModel.selectStableSessionListState).byId
          // oxlint-disable-next-line antislop/no-passthrough-variable -- widens the SessionId-keyed record so a tab's plain string id can look a row up.
          const rowsById: Readonly<Record<string, SessionSummary | undefined>> = byId
          const sessionOf = (sessionId: string): SessionSummary | undefined => (Object.hasOwn(rowsById, sessionId) ? rowsById[sessionId] : undefined)
          const workspaceItems = props.useWorkspaces(state => HostSnapshotsModel.selectStableWorkspaceItems(state.items))
          const threadDirectories = useThreadDirectories(workspaceItems)
          const workspaceForThread = useMemo(
            () => createThreadWorkspaceResolver({ byId, workspaces: workspaceItems, threadDirectories }),
            [byId, threadDirectories, workspaceItems],
          )
          const showProjectName = settings.value?.showProjectName ?? false
          const projectNames = useMemo(() => (showProjectName ? ProjectNames.byWorkspaceId(workspaceItems) : undefined), [showProjectName, workspaceItems])
          const statuses = props.useSessionStatus(HostSnapshotsModel.selectStableSessionStatus)
          // Attention is Host-owned now, so the dot follows the same record the sidebar acknowledges,
          // and both read the one page-wide poll instead of each holding their own interval.
          const attention = useThreadAttention({ enabled: true })
          const { records: attentionRecords, clearUnread: clearAttention } = attention
          useLayoutEffect(() => {
            // An explicit tab selection clears only the attention version the browser rendered.
            clearSelectedAttention = sessionId => {
              const record = attentionRecords.get(sessionId)
              if (record !== undefined) clearAttention(sessionId, record.version)
            }
            return () => {
              clearSelectedAttention = undefined
            }
          }, [attentionRecords, clearAttention])
          const attentionSessionIds = useMemo(() => new Set(attention.views.map(record => record.sessionId)), [attention.views])
          const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot)
          const startContentVersion = useMemo(() => ({ byId, statuses, catalog, panelVersion }), [byId, statuses, catalog, panelVersion])

          const set = snapshot.context.sets[snapshot.context.scopeKey]
          const tabs = (set?.tabs ?? []).map((tab): WorkbenchTab => {
            const base = { id: tab.id, target: tab.target, active: tab.id === set?.activeTabId, pinned: tab.pinned, preview: tab.preview }
            if (tab.target.kind === 'start') return { ...base, kind: 'start', title: translate('startTab'), available: true, status: null }
            if (tab.target.kind === 'panel') {
              const panelId = tab.target.panelId
              return {
                ...base,
                kind: 'panel',
                panelId,
                title: tab.title ?? panelLabels.get(panelId) ?? panelTitleFallback(panelId),
                available: registeredPanels.has(panelId),
                status: null,
              }
            }
            const sessionId = tab.target.sessionId
            const session = sessionOf(sessionId)
            const status = session === undefined ? undefined : statuses.get(session.id)
            const tabStatus = threadTabStatus({
              needsYou: status?.pendingInteraction !== undefined,
              running: status?.running ?? session?.running ?? false,
              unread: session !== undefined && attentionSessionIds.has(session.id),
            })
            const title = session?.title ?? (session === undefined || session.blank ? translate('untitledThread') : session.displayTitle)
            const workspaceId = workspaceForThread(sessionId)
            const threadTab = {
              ...base,
              kind: 'thread',
              sessionId,
              title,
              available: session !== undefined,
              status: tabStatus,
            } satisfies TabView
            return workspaceId === undefined ? threadTab : { ...threadTab, workspaceId }
          })

          const busyTabIds = tabs.flatMap(tab => (tab.status === 'running' || tab.status === 'needsYou' ? [tab.id] : [])).join('\n')
          useEffect(() => {
            actor.send({ type: 'tabs.busy', tabIds: busyTabIds === '' ? [] : busyTabIds.split('\n') })
          }, [busyTabIds])

          // Workbench draws its own tab chrome; the strip is the native surface's.
          const showStrip = props.mode === 'native' && snapshot.matches('on')
          const startShown = showStrip && set?.activeTabId === START_TAB_ID
          useHiddenMainPanel(props.holdMainHidden, startShown)

          const shortcutOf = (commandId: string) => catalog.find(entry => entry.id === commandId)
          const pick = (target: HostTarget | null): void => actor.send({ type: 'start.pick', target })
          const startSections = (): readonly StartSection[] => {
            const threads = recentThreads(
              ctx.sessions.list.getSnapshot().ids.flatMap(id => sessionOf(id) ?? []),
              session => statuses.get(session.id)?.running ?? session.running,
            )
            const panels = ctx.slots
              .entriesOfSlot('sidebar.panellist')
              .filter(entry => entry.options.id !== undefined && registeredPanels.has(entry.options.id))
              .toSorted((left, right) => (left.options.order ?? 0) - (right.options.order ?? 0))
            const sections: readonly StartSection[] = [
              {
                id: 'new-thread',
                column: 'threads',
                suggestions: [
                  {
                    id: 'new-thread',
                    title: translate('newThread'),
                    icon: <MessageSquarePlusIcon aria-hidden size={22} strokeWidth={1.5} />,
                    shortcut: shortcutOf('session.new'),
                    pick: () => {
                      actor.send({ type: 'start.newThread' })
                      ctx.uiWorkspace.startSession()
                    },
                  },
                ],
              },
              {
                id: 'recent-threads',
                column: 'threads',
                label: translate('recentThreads'),
                suggestions: threads.map(session => {
                  const project = session.cwd?.split('/').filter(Boolean).at(-1)
                  const running = statuses.get(session.id)?.running ?? session.running
                  return {
                    id: `thread:${session.id}`,
                    title: session.title ?? session.displayTitle,
                    description: [running ? translate('running') : undefined, project].filter(Boolean).join(' · ') || undefined,
                    icon: <MessageSquareIcon aria-hidden size={22} strokeWidth={1.5} />,
                    shortcut: undefined,
                    pick: () => pick({ kind: 'thread', sessionId: session.id }),
                  }
                }),
              },
              {
                id: 'panels',
                column: 'panels',
                label: translate('panels'),
                suggestions: panels.flatMap(entry => {
                  const panelId = entry.options.id
                  if (panelId === undefined) return []
                  const title = panelLabels.get(panelId) ?? panelTitleFallback(panelId)
                  const former = [resolveSlotLabel(entry.options.label), ...(KNOWN_SECTIONS.find(section => section.panelId === panelId)?.formerLabels ?? [])]
                  return {
                    id: `panel:${panelId}`,
                    title,
                    keywords: former.filter(label => label !== undefined && label !== title).join(' '),
                    icon: <PanelIcon glyph={entry.component} fallback={<PanelsTopLeftIcon aria-hidden size={22} strokeWidth={1.5} />} />,
                    shortcut: panelShortcut(catalog, title),
                    pick: () => pick({ kind: 'panel', panelId }),
                  }
                }),
              },
              {
                id: 'settings',
                column: 'panels',
                suggestions: [
                  {
                    id: 'settings',
                    title: translate('settings'),
                    icon: <SettingsIcon aria-hidden size={22} strokeWidth={1.5} />,
                    shortcut: shortcutOf('settings.open'),
                    pick: () => {
                      pick(null)
                      if (runHostCommand(ctx.shortcuts, SETTINGS_COMMAND_ID)) return
                      document.querySelector<HTMLElement>(SETTINGS_TRIGGER_SELECTOR)?.click()
                    },
                  },
                ],
              },
            ]
            return sections.filter(section => section.suggestions.length > 0)
          }

          useLayoutEffect(() => {
            publication.update(
              {
                enabled: snapshot.matches('on'),
                closeButtonPosition,
                scopeKey: snapshot.context.scopeKey,
                activeTabId: set?.activeTabId ?? null,
                tabs,
              },
              () => <StartPage sections={startSections()} t={props.t} />,
              startContentVersion,
            )
          })
          if (!showStrip) return null

          return (
            <div data-dshfiles-main-tabs="" style={{ display: 'contents' }}>
              <TabStrip
                tabs={tabs}
                send={sendStripEvent}
                t={props.t}
                newTabKeys={shortcutOf('mainTabs.newTab')?.keys.join('') ?? ''}
                renameThread={renameThread}
                closeButtonPosition={closeButtonPosition}
                fixedWidth={settings.value?.fixedTabWidth ?? false}
                {...(projectNames === undefined ? {} : { projectNames })}
              />
              {startShown ? <StartPage sections={startSections()} t={props.t} /> : null}
            </div>
          )
        }),
      ),
    )

    interface TabCommand {
      readonly id: string
      readonly label: () => string
      /** Absent when another registered command already owns this chord on every desktop shell. */
      readonly desktop?: ShortcutBinding
      /** Desktop Linux reserves Tab, so cycling uses Ctrl+Shift+] / [ there. */
      readonly linux?: ShortcutBinding
      readonly web?: ShortcutBinding
      readonly defaults?: ShortcutCommand['defaults']
      readonly event: TabsEvent
    }
    const commands: readonly TabCommand[] = [
      {
        id: 'mainTabs.newTab',
        label: () => translate('newTab'),
        desktop: { code: 'KeyT', modifiers: ['primary'] },
        web: { code: 'KeyT', modifiers: ['primary', 'alt'] },
        event: { type: 'tab.new' },
      },
      {
        id: 'mainTabs.reopenClosed',
        label: () => translate('reopenClosedTab'),
        desktop: { code: 'KeyT', modifiers: ['primary', 'shift'] },
        web: { code: 'KeyT', modifiers: ['primary', 'alt', 'shift'] },
        event: { type: 'tab.reopenClosed' },
      },
      {
        // DSH's own page.close owns Mod+W on every desktop shell, and the Host's shortcut registry
        // refuses two commands that claim one default, so this command ships without a default and
        // stays rebindable in Settings › Shortcuts instead of failing to register on every launch.
        id: 'mainTabs.closeActive',
        label: () => translate('closeActiveTab'),
        event: { type: 'tab.closeActive' },
      },
      {
        id: 'mainTabs.next',
        label: () => translate('nextTab'),
        desktop: { code: 'Tab', modifiers: ['control'] },
        linux: { code: 'BracketRight', modifiers: ['control', 'shift'] },
        web: { code: 'BracketRight', modifiers: ['primary', 'alt'] },
        event: { type: 'tab.cycle', direction: 1 },
      },
      {
        id: 'mainTabs.previous',
        label: () => translate('previousTab'),
        desktop: { code: 'Tab', modifiers: ['control', 'shift'] },
        linux: { code: 'BracketLeft', modifiers: ['control', 'shift'] },
        web: { code: 'BracketLeft', modifiers: ['primary', 'alt'] },
        event: { type: 'tab.cycle', direction: -1 },
      },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((index): TabCommand => ({
        id: `mainTabs.goTo${index}`,
        label: () => (index === 9 ? translate('goToLastTab') : translate('goToTab', { index: String(index) })),
        desktop: { code: `Digit${index}`, modifiers: ['primary'] },
        web: { code: `Digit${index}`, modifiers: ['primary', 'alt'] },
        event: { type: 'tab.activateIndex', index: index === 9 ? -1 : index - 1 },
      })),
    ]
    const defaultsFor = (command: TabCommand): ShortcutCommand['defaults'] => {
      if (command.defaults !== undefined) return command.defaults
      if (command.desktop === undefined) return {}
      const defaults: ShortcutCommand['defaults'] = {
        'desktop:macos': command.desktop,
        'desktop:windows': command.desktop,
        'desktop:linux': command.linux ?? command.desktop,
      }
      if (command.web === undefined) return defaults
      return { ...defaults, 'web:macos': command.web, 'web:windows': command.web }
    }
    for (const command of commands) {
      const commandId = command.id
      if (!isShortcutCommandId(commandId)) continue
      // A binding another command already owns makes registration throw; the command then stays unbound but listed.
      ctx.effect(() => {
        const register = (withDefaults: boolean): (() => void) =>
          ctx.shortcuts.register({
            id: commandId,
            label: command.label,
            aliases: ['tab', 'tabs'],
            defaults: withDefaults ? defaultsFor(command) : {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => {
              const snapshot = actor.getSnapshot()
              if (!snapshot.matches('on')) return { status: 'pass' }
              if (command.event.type === 'tab.closeActive') {
                const activeTabId = snapshot.context.sets[snapshot.context.scopeKey]?.activeTabId
                if (activeTabId === undefined || activeTabId === null) return { status: 'pass' }
              }
              return {
                status: 'handled',
                run: () => {
                  if (command.event.type === 'tab.new') ctx.layout.beginNavigation()
                  actor.send(command.event)
                },
              }
            },
          })
        try {
          return register(true)
        } catch (error) {
          console.warn(`main-tabs: ${commandId} keeps no default binding`, error)
          try {
            return register(false)
          } catch {
            return () => undefined
          }
        }
      }, `main-tabs: ${commandId} shortcut`)
    }
  },
})
