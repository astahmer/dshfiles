/**
 * Browser half: fill the frame's right column with the panel, put the expand
 * button in the conversation header, and own the seats a tab type registers
 * into.
 *
 * Two seats share one session-scoped store, which the slot runtime allows
 * because both are session-scoped (a handle may not span scopes). The panel seat
 * in the frame draws the surface normally or fullscreen, retaining the track
 * on wide viewports; the header's corner seat draws the way back in
 * while the panel is hidden. The store is the layout's only source of truth; the docking
 * kit's pure planners compute every change and the store records them, one
 * history entry per intent.
 *
 * The frame is a base package and never injects this one. What it needs —
 * whether the panel is shown and whether it wants a track — arrives through its
 * own `ctx.layout` action face, reported by the seat that knows both facts.
 *
 * Tab types register in two stages: the type itself into `ctx.sidebarRightTabs`,
 * its body into the keyed `sidebar.right.pane.tab` seat under the same kind. The
 * guide registers through those stages unmodified, exactly as a type shipped
 * from another package does — `ui-sidebar-documentpreview` is the live proof.
 */
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import { SidebarFocus } from './focus.ts'
import { registerSidebarShortcuts } from './shortcuts.ts'
import type { ClientContext } from '@dshfiles/dshx/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@dshfiles/frame-layout/regions'
import { ResourceSeat, type ResourceSeatInjected } from '../../resource-seat.js'
import { SidebarResourcePanelModel, sidebarResourcePanels } from '../../resource-panels.js'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from './contract/slots.ts'
import { GuideBody, type GuideInjected } from './tabs/guide/GuideBody.tsx'
import { GuideTitle } from './tabs/guide/GuideTitle.tsx'
import { ExpandButton } from './shell/ExpandButton.tsx'
import type { SidebarRightInjected } from './shell/SidebarRight.tsx'
import { closeWithPaneFocus, openWithPaneFocus } from './shell/close-focus.ts'
import { RightbarRoot, type RightbarRootInjected } from './shell/RightbarRoot.tsx'
import { SidebarSessionViews } from './session-views.ts'
import { createSidebarRightController } from './service.ts'
import { SidebarRightTabRegistry } from './tab-registry.ts'
import { createSidebarRightStore } from './stores.ts'
import { en, zh } from './locales.ts'
import { GUIDE_ID, guideDefinition } from './tabs/guide/definition.ts'
import { guideTabInfoFactory, tabInfoFactory } from './tab-info.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { defaultSeed } from './contract/seed.ts'

/** This package's copy namespace. */
const NS = 'sidebarRight'

/** Required browser services: the slot registry, the frame's panel actions, copy, and the resource model. */
export const inject = ['slots', 'layout', 'locale', 'resources', 'sessions', 'uiSession', 'shortcuts']

// The original public /client module owns Cordis type identities. Runtime services
// below implement the same contract; importing both class augmentations would
// duplicate nominal private-field identities in this fork's TypeScript program.

/**
 * Client plugin body: provide the registry and the navigation face, register the
 * panel seat and the rail seat over one store with their extension children, and
 * register the guide type through the same public two-stage path any other type
 * uses.
 * @param ctx - client root context carrying the slot registry, the frame's face, and copy.
 */
export function apply(ctx: ClientContext): void {
  // The registry and the face it backs are built here, at apply's top level,
  // and never inside an effect. A registry other packages register into cannot
  // have an effect-internal scope as its host: `register()` adds an effect to
  // this fiber, and doing that from another plugin's apply while the effect is
  // still the active scope stalls browser boot with no error at all. The
  // template this follows (ui-conversation's definition registry) is built at
  // its own apply top level for the same reason.
  const t = ctx.locale.bind(NS)
  const tabs = new SidebarRightTabRegistry(ctx)
  const sessionReleases = new Map<SessionId, () => void>()
  const views = new SidebarSessionViews(ctx.sessions, sessionId => {
    sessionReleases.get(sessionId)?.()
    sessionReleases.delete(sessionId)
  })
  const resourcePanels = sidebarResourcePanels()
  const mainSurface = ctx.get('mainSurface')
  const workbenchMode = {
    getSnapshot: (): boolean => mainSurface?.mode() === 'workbench',
    subscribe: (listener: () => void): (() => void) => mainSurface?.subscribe(listener) ?? (() => {}),
  }
  ctx.effect(() => {
    const current = ctx.uiSession.adapter.current
    const sync = (): void => {
      views.select(current.getSnapshot().key as SessionId | undefined)
    }
    const unsubscribe = current.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      views.dispose()
    }
  }, 'ui-sidebar-right: retained Session views')
  const layout: ILayout = ctx.layout
  // The automatic fullscreen rule as the seats last rendered it: the frame
  // hands them its width as owner props, and every seat reports the same rule.
  let autoFullscreen = false
  let mintStore: ((sessionId: SessionId) => void) | undefined
  const { controller, adopt, forget, show, measure } = createSidebarRightController(
    tabs,
    (address, signal) => {
      ctx.resources.pin(address, signal)
    },
    {
      workbench: workbenchMode.getSnapshot,
      dock: () => ctx.get('rightPanel')?.dock?.(),
      mint: sessionId => mintStore?.(sessionId),
      autoFullscreen: () => autoFullscreen,
      openWithFocus: (sessionId, open) => {
        openWithPaneFocus(document, sessionId, open)
      },
      closeWithFocus: (sessionId, paneId, close) => {
        closeWithPaneFocus(document, sessionId, paneId, close)
      },
    },
  )
  ctx.effect(() => {
    const sync = (): void => {
      const ids = workbenchMode.getSnapshot()
        ? [
            ...new Set(
              controller.openTabs
                .getSnapshot()
                .filter(tab => tab.kind !== 'guide' && tab.kind !== 'dshfiles-workbench-side-panel')
                .map(tab => tab.sessionId),
            ),
          ].filter(id => ctx.sessions.list.getSnapshot().ids.includes(id))
        : []
      views.retainResourceSessions(ids)
    }
    const unsubscribeTabs = controller.openTabs.subscribe(sync)
    const unsubscribeMode = workbenchMode.subscribe(sync)
    const unsubscribeCatalog = ctx.sessions.list.subscribe(sync)
    sync()
    return () => {
      unsubscribeTabs()
      unsubscribeMode()
      unsubscribeCatalog()
      views.retainResourceSessions([])
    }
  }, 'sidebar-right: saved resource Session references')
  // The Session on screen: the selected one while the Conversation fills the
  // main column. Both sources notify before React renders their change, so the
  // service names the arriving Session before any component of that commit
  // reads it, and its seat mints the Session's store in the same render.
  ctx.effect(() => {
    const sync = (): void => {
      const selected = views.source.getSnapshot().find(view => view.selected)
      show(workbenchMode.getSnapshot() || layout.panelInfo.getSnapshot().activePanelId === null ? selected?.sessionId : undefined)
    }
    const unsubscribeViews = views.source.subscribe(sync)
    const unsubscribePanel = layout.panelInfo.subscribe(sync)
    const unsubscribeMode = workbenchMode.subscribe(sync)
    sync()
    return () => {
      unsubscribeViews()
      unsubscribePanel()
      unsubscribeMode()
      show(undefined)
    }
  }, 'ui-sidebar-right: on-screen Session')
  const disposeRegistry = ctx.reflect.provide('sidebarRightTabs', tabs)
  const disposeService = ctx.reflect.provide('sidebarRight', controller)
  // Registered first, so it tears down last: the faces outlive every seat and
  // type that reaches for them. provide()'s disposer settles asynchronously;
  // teardown is synchronous fire-and-forget, matching ui-layout's root entry.
  // Unloading aborts every tab occurrence, which releases every pin.
  ctx.effect(
    () => () => {
      controller.tabDomain.dispose()
      void disposeService()
      void disposeRegistry()
    },
    'ui-sidebar-right: service faces',
  )

  ctx.effect(
    () =>
      resourcePanels.registerPageOpener?.((kind, beforePublish) =>
        controller.openWorkbenchPage(kind, (sessionId, tabId) => beforePublish(SidebarResourcePanelModel.id(sessionId, tabId))),
      ) ?? (() => {}),
    'sidebar-right: Workbench page admission',
  )

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-right: dictionaries')
  ctx.effect(
    () =>
      registerSidebarShortcuts(ctx.shortcuts, controller, t, () => {
        void ctx.shortcuts.closeWindow().catch((error: unknown) => {
          console.error('Window close failed', error)
        })
      }),
    'ui-sidebar-right: shortcuts',
  )
  if (typeof document !== 'undefined') ctx.effect(() => SidebarFocus.observe(document), 'ui-sidebar-right: focus')

  ctx.effect(() => {
    const handle = createSidebarRightStore(() => defaultSeed(tabs))
    // Each Session Context generation owns one Store. Background tab actions
    // use the latest adoption for that Session.
    const store: typeof handle = {
      ...handle,
      create: scopeKey => {
        const instance = handle.create(scopeKey)
        if (scopeKey !== undefined) {
          const sessionId = scopeKey as SessionId
          sessionReleases.get(sessionId)?.()
          const releaseAdoption = adopt(sessionId, instance)
          let releaseProjection: (() => void) | undefined
          const navigationSubscriptions = new Map<TabId, () => void>()
          const sync = (): void => {
            // Only the on-screen Session projects into the Workbench: every loaded Session keeps its own store, and
            // projecting them all opened one dock panel per Session for the same tab kind.
            const rows =
              controller.mounted.getSnapshot() !== sessionId
                ? []
                : Object.values(instance.getSnapshot().bySession[sessionId]?.layout.tabs ?? {}).filter(
                    tab => tab.kind !== 'guide' && tab.kind !== 'dshfiles-workbench-side-panel',
                  )
            for (const [tabId, unsubscribe] of navigationSubscriptions) {
              if (!rows.some(tab => tab.id === tabId)) {
                unsubscribe()
                navigationSubscriptions.delete(tabId)
              }
            }
            for (const tab of rows) {
              if (!navigationSubscriptions.has(tab.id))
                navigationSubscriptions.set(tab.id, controller.tabDomain.occurrence(sessionId, tab).navigation.subscribe(sync))
            }
            // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: `releaseProjection` is reassigned before the old projection is released.
            const previous = releaseProjection
            releaseProjection = resourcePanels.publish(
              sessionId,
              rows.map(tab => ({
                id: SidebarResourcePanelModel.id(sessionId, tab.id),
                sessionId,
                tabId: tab.id,
                kind: tab.kind,
                title: tab.title,
                address: tab.contentId,
                navigationRevision: controller.tabDomain.occurrence(sessionId, tab).navigation.getSnapshot().revision,
              })),
              tabId => controller.closeIn(sessionId, tabId as TabId),
            )
            // New projection owns the key before old cleanup: observers never see a false close.
            previous?.()
          }
          const unsubscribe = instance.subscribe(sync)
          const unsubscribeMode = workbenchMode.subscribe(sync)
          const unsubscribeMounted = controller.mounted.subscribe(sync)
          sync()
          sessionReleases.set(sessionId, () => {
            unsubscribe()
            unsubscribeMode()
            unsubscribeMounted()
            releaseProjection?.()
            for (const unsubscribe of navigationSubscriptions.values()) unsubscribe()
            navigationSubscriptions.clear()
            releaseAdoption()
          })
        }
        return {
          ...instance,
          clearPersisted() {
            instance.clearPersisted()
            if (scopeKey !== undefined) forget(scopeKey as SessionId)
          },
        }
      },
    }
    // A link can be followed before its Session's seat renders (a Workbench thread
    // panel, a Session the native selection does not name). The persisted store
    // the seat reads later already holds the opened tab.
    mintStore = sessionId => {
      store.create(sessionId)
    }
    const injected: Omit<SidebarRightInjected, 'keyedHooks' | 'occurrence' | 'closeTab' | 'measureRoom'> = {
      syncPresentation({ shown, track, fullscreen }) {
        // The native seat's unmount cleanup can run after Workbench takes over.
        // It must not overwrite the global dock's presentation report.
        if (workbenchMode.getSnapshot()) return
        if (shown) layout.openRightbar(track, fullscreen)
        else layout.closeRightbar()
      },
      reportAutoFullscreen: value => {
        autoFullscreen = value
      },
      splitPane: paneId => {
        controller.split(paneId)
      },
      toggleFullscreen: () => {
        const target = controller.commandTarget()
        if (target !== undefined) controller.toggleFullscreen(target)
      },
      openTab: (kind, options) => {
        controller.openTab(kind, options)
      },
      hooks: {
        shortcuts: ctx.shortcuts.catalog,
        tabTypes: { subscribe: listener => tabs.subscribe(listener), getSnapshot: () => tabs.entries() },
      },
    }

    const disposeTypes = [tabs.register(guideDefinition(t))]
    const disposeSeat = ctx.slots.inject('rightbar', function* () {
      yield ctx.slots.register(
        {
          name: 'rightbar',
          children: { 'rightbar.session': { kind: 'single', scope: 'session' } },
          inject: (): RightbarRootInjected => ({
            hooks: { views: views.source, workbenchMode },
            mountView: reference => views.mount(reference),
          }),
        },
        RightbarRoot,
      )
      yield ctx.slots.register(
        {
          name: 'rightbar.session',
          locale: NS,
          children: {
            'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
            'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
            'sidebar.right.tab.menu.item': { kind: 'list', scope: 'session' },
          },
          store,
          inject: (sessionId): SidebarRightInjected & ResourceSeatInjected => ({
            ...injected,
            hooks: { ...injected.hooks, workbenchMode, resourceTargets: resourcePanels.targets },
            measureRoom: canSplitPane => {
              measure(sessionId, canSplitPane)
            },
            closeTab: tabId => {
              try {
                controller.closeIn(sessionId, tabId)
              } catch (error) {
                console.error('Sidebar tab close failed:', error)
              }
            },
            keyedHooks: { tabNavigation: key => controller.tabDomain.occurrence(sessionId, { id: key as TabId }).navigation },
            occurrence: tab => controller.tabDomain.occurrence(sessionId, tab),
          }),
        },
        ResourceSeat,
      )
    })
    // Native expansion still shares the Session store. In Workbench the same
    // header opener reads and opens the registered global dock instead, never
    // a retained native carrier. Its separate corner seat moves no utilities.
    const disposeExpand = ctx.slots.inject('conversation.session.header.corner', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.corner',
          locale: NS,
          store,
          inject: () => ({ dock: () => ctx.get('rightPanel')?.dock?.(), hooks: { shortcuts: ctx.shortcuts.catalog, workbenchMode } }),
        },
        ExpandButton,
      ),
    )
    // Stage two for the guide: it declares the chain child it hosts and reads
    // the registry's entry boxes, which an ordinary type has no reason to do.
    const guideInjected: GuideInjected = {
      hooks: {
        shortcuts: ctx.shortcuts.catalog,
        guideEntries: { subscribe: listener => tabs.subscribe(listener), getSnapshot: () => tabs.guide() },
      },
    }
    const disposeGuide = ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: GUIDE_ID,
          children: {
            'sidebar.right.tab.guide.entry': {
              kind: 'keyed',
              scope: 'session',
              inject: { hooks: { tabInfo: guideTabInfoFactory } },
            },
            'sidebar.right.tab.guide': {
              kind: 'chain',
              scope: 'session',
              inject: { hooks: { tabInfo: guideTabInfoFactory } },
            },
          },
          inject: () => guideInjected,
        },
        GuideBody,
      ),
    )
    const disposeGuideTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: GUIDE_ID }, GuideTitle),
    )
    return () => {
      mintStore = undefined
      disposeGuideTitle()
      disposeGuide()
      disposeExpand()
      disposeSeat()
      for (const dispose of disposeTypes.reverse()) dispose()
      for (const release of sessionReleases.values()) release()
      sessionReleases.clear()
    }
  }, 'ui-sidebar-right: seats and shipped tab type')
}
