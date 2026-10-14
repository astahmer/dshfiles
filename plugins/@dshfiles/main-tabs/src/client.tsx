import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient, useSettings } from '@dshfiles/dshx/client'
import { MessageSquareIcon, MessageSquarePlusIcon, PanelsTopLeftIcon, SettingsIcon } from '@dshfiles/plugin-ui/icons'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { createPortal } from 'react-dom'
import { readHostView } from './host-target.js'
import { MAIN_TABS_LOCALE_NAMESPACE, mainTabsLocale } from './locales.js'
import { mainTabsSettings } from './settings.js'
import { PanelIcon, StartPage, type StartSection } from './start-page.js'
import { panelShortcut, recentThreads } from './start-suggestions.js'
import { TabStrip, threadTabStatus, type TabView } from './tab-strip.js'
import { DEFAULT_TAB_PREFERENCES, START_TAB_ID, tabIdOf, tabsMachine, type HostTarget, type TabPreferences, type TabsEvent } from './tabs-machine.js'
import { STRIP_MISPLACED_WARNING, STRIP_MISSING_WARNING, mountStripHost, stripSitsAbovePanel } from './strip-mount.js'
import { saveTabs, storedTabs } from './tabs-storage.js'
import './client.css'

const THREAD_TAB_KEEP_EVENT = 'dshfiles:main-tabs:keep-thread'
const threadTabKeepRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()

const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)

/** "dshfiles-multi-host-thread" → "Multi host thread", for a main panel without a sidebar entry to name it. */
const panelTitleFallback = (panelId: string): string => {
  const words = panelId.replace(/^dshfiles-/u, '').replaceAll(/[-_.]+/gu, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const STRIP_MISSING_AFTER_MS = 3_000

/**
 * Settings is a modal whose open action stays private to `ui-settings-general` (its shell store is not exported and
 * the shortcut registry cannot run a command), so the new-tab page presses the sidebar's own Settings trigger.
 */
const SETTINGS_TRIGGER_SELECTOR = '[data-slot="settings.launcher"] button[aria-haspopup="dialog"]'

/** While the new-tab page shows, the main panel under it stays mounted but hidden, keeping a thread's scroll and state. */
const useHiddenMainPanel = (host: HTMLElement | null, hidden: boolean): void => {
  useLayoutEffect(() => {
    const outlet = host?.nextElementSibling
    if (!hidden || !(outlet instanceof HTMLElement)) return
    const display = outlet.style.display
    outlet.style.display = 'none'
    return () => {
      outlet.style.display = display
    }
  })
}

/** The strip's host node before the `main` outlet, with the startup self-check warning when it cannot mount. */
const useStripHost = (): HTMLElement | null => {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(
    () => mountStripHost({ document, onHost: setHost, onMissing: () => console.warn(STRIP_MISSING_WARNING), missingAfterMs: STRIP_MISSING_AFTER_MS }),
    [],
  )
  return host
}

/** Warn once per host when the rendered strip does not sit on top of the main panel. */
const usePlacementCheck = (host: HTMLElement | null, rendered: boolean): void => {
  const checked = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (host === null || !rendered || checked.current === host) return
    const frame = requestAnimationFrame(() => {
      checked.current = host
      if (!stripSitsAbovePanel(host)) console.warn(STRIP_MISPLACED_WARNING)
    })
    return () => cancelAnimationFrame(frame)
  }, [host, rendered])
}

/**
 * Another plugin asks for a thread through this cancelable window event; a cancelled dispatch means a tab took it, so
 * the caller falls back to `uiWorkspace.openSession` only when this plugin is absent or switched off.
 */
const OPEN_THREAD_EVENT = 'dshfiles:open-thread'
const openThreadRequestSchema = z.object({ sessionId: z.string().min(1), newTab: z.boolean() })

export default defineClient({
  name: '@dshfiles/main-tabs',
  locales: [mainTabsLocale],
  inject: ['slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'shortcuts'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(MAIN_TABS_LOCALE_NAMESPACE)

    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)

    const navigate = (target: HostTarget): boolean => {
      if (target.kind === 'panel') {
        if (!isMainPanelId(target.panelId)) return false
        ctx.layout.selectPanel(target.panelId)
        return true
      }
      const sessionId = ctx.sessions.list.getSnapshot().ids.find(id => id === target.sessionId)
      if (sessionId === undefined) return false
      ctx.uiWorkspace.openSession(sessionId)
      return true
    }

    const actor = createActor(tabsMachine, { input: { ports: { navigate, save: saveTabs }, persisted: storedTabs.get() } })
    ctx.effect(() => {
      actor.start()
      return () => actor.stop()
    }, 'main-tabs: tabs machine')

    ctx.effect(() => {
      const onOpenThread = (event: Event): void => {
        const request = event instanceof CustomEvent ? openThreadRequestSchema.safeParse(event.detail) : undefined
        if (request?.success !== true || !actor.getSnapshot().matches('on')) return
        event.preventDefault()
        actor.send({ type: 'tab.open', target: { kind: 'thread', sessionId: request.data.sessionId }, newTab: request.data.newTab })
      }
      window.addEventListener(OPEN_THREAD_EVENT, onOpenThread)
      return () => window.removeEventListener(OPEN_THREAD_EVENT, onOpenThread)
    }, 'main-tabs: open a thread for another plugin')

    ctx.effect(() => {
      const keepThreadTab = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const request = threadTabKeepRequestSchema.safeParse(event.detail)
        if (!request.success) return
        actor.send({ type: 'thread.keep', sessionId: request.data.sessionId })
      }
      window.addEventListener(THREAD_TAB_KEEP_EVENT, keepThreadTab)
      return () => window.removeEventListener(THREAD_TAB_KEEP_EVENT, keepThreadTab)
    }, 'main-tabs: keep double-clicked sidebar threads')

    ctx.effect(() => {
      let reported = ''
      const report = (): void => {
        const sessions = ctx.sessions.list.getSnapshot()
        // Before the list arrives, "no Session in the main view" is not yet a fact.
        if (sessions.phase !== 'ready') return
        const view = readHostView({
          activePanelId: ctx.layout.panelInfo.getSnapshot().activePanelId,
          sessions: sessions.ids.flatMap(id => sessions.byId[id] ?? []),
          workspaces: ctx.workspaces.list.getSnapshot().items,
        })
        const key = `${view.target === null ? '' : tabIdOf(view.target)}|${view.projectId ?? ''}`
        if (key !== reported) {
          reported = key
          actor.send({ type: 'host.navigated', target: view.target, projectId: view.projectId })
        }
        const known = new Set(Object.keys(sessions.byId))
        const missing = Object.values(actor.getSnapshot().context.sets)
          .flatMap(set => set.tabs)
          .flatMap(tab => (tab.target.kind === 'thread' && !known.has(tab.target.sessionId) ? [tab.target.sessionId] : []))
        if (missing.length > 0) actor.send({ type: 'threads.missing', sessionIds: [...new Set(missing)] })
      }
      const disposers = [ctx.layout.panelInfo.subscribe(report), ctx.sessions.list.subscribe(report), ctx.workspaces.list.subscribe(report)]
      report()
      return () => disposers.forEach(dispose => dispose())
    }, 'main-tabs: follow the main view')

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

    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-main-tabs', order: 10, locale: MAIN_TABS_LOCALE_NAMESPACE },
        decorate(props => {
          const settings = useSettings(mainTabsSettings)
          const preferences: TabPreferences | null =
            settings.value !== undefined ? settings.value : settings.status === 'loading' && settings.error === null ? null : DEFAULT_TAB_PREFERENCES
          useEffect(() => {
            if (preferences !== null) actor.send({ type: 'preferences.changed', preferences })
          }, [preferences])

          const snapshot = useSyncExternalStore(subscribeActor, () => actor.getSnapshot())
          // Re-render when panels register or the locale changes; the ledger reads below are cheap.
          useSyncExternalStore(subscribePanels, panelsVersion)
          const registeredPanels = new Set(ctx.slots.entriesOfSlot('main').flatMap(entry => entry.options.key ?? []))
          const panelLabels = new Map(
            ctx.slots.entriesOfSlot('sidebar.panellist').flatMap(entry => {
              const label = resolveSlotLabel(entry.options.label)
              return entry.options.id === undefined || label === undefined ? [] : [[entry.options.id, label] as const]
            }),
          )
          const byId = props.useSessions(state => state.byId)
          const sessions = useMemo(() => new Map<string, SessionSummary>(Object.values(byId).map(session => [session.id, session])), [byId])
          const statuses = props.useSessionStatus(state => state)
          const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot)
          const host = useStripHost()

          const set = snapshot.context.sets[snapshot.context.scopeKey]
          const tabs = (set?.tabs ?? []).map((tab): TabView => {
            const base = { id: tab.id, active: tab.id === set?.activeTabId, pinned: tab.pinned, preview: tab.preview }
            if (tab.target.kind === 'start') return { ...base, kind: 'start', title: translate('startTab'), available: true, status: null }
            if (tab.target.kind === 'panel') {
              const panelId = tab.target.panelId
              return {
                ...base,
                kind: 'panel',
                title: panelLabels.get(panelId) ?? panelTitleFallback(panelId),
                available: registeredPanels.has(panelId),
                status: null,
              }
            }
            const session = sessions.get(tab.target.sessionId)
            const status = session === undefined ? undefined : statuses.get(session.id)
            const tabStatus = threadTabStatus({
              needsYou: status?.pendingInteraction !== undefined,
              running: status?.running ?? session?.running ?? false,
              unread: status?.completionUnread ?? false,
            })
            const title = session?.title ?? (session === undefined || session.blank ? translate('untitledThread') : session.displayTitle)
            return { ...base, kind: 'thread', title, available: session !== undefined, status: tabStatus }
          })

          const showStrip = host !== null && snapshot.matches('on')
          const startShown = showStrip && set?.activeTabId === START_TAB_ID
          usePlacementCheck(host, showStrip && !startShown)
          useHiddenMainPanel(host, startShown)
          if (host === null || !showStrip) return null

          const shortcutOf = (commandId: string) => catalog.find(entry => entry.id === commandId)
          const pick = (target: HostTarget | null): void => actor.send({ type: 'start.pick', target })
          const startSections = (): readonly StartSection[] => {
            const threads = recentThreads(
              ctx.sessions.list.getSnapshot().ids.flatMap(id => sessions.get(id) ?? []),
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
                      pick(null)
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
                  return {
                    id: `panel:${panelId}`,
                    title,
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
                      document.querySelector<HTMLElement>(SETTINGS_TRIGGER_SELECTOR)?.click()
                    },
                  },
                ],
              },
            ]
            return sections.filter(section => section.suggestions.length > 0)
          }

          return createPortal(
            <>
              <TabStrip tabs={tabs} send={event => actor.send(event)} t={props.t} newTabKeys={shortcutOf('mainTabs.newTab')?.keys.join('') ?? ''} />
              {startShown ? <StartPage sections={startSections()} t={props.t} /> : null}
            </>,
            host,
          )
        }),
      ),
    )

    interface TabCommand {
      readonly id: string
      readonly label: () => string
      readonly desktop: ShortcutBinding
      /** Desktop Linux reserves Tab, so cycling uses Ctrl+Shift+] / [ there. */
      readonly linux?: ShortcutBinding
      readonly web: ShortcutBinding
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
            defaults: withDefaults
              ? {
                  'desktop:macos': command.desktop,
                  'desktop:windows': command.desktop,
                  'desktop:linux': command.linux ?? command.desktop,
                  'web:macos': command.web,
                  'web:windows': command.web,
                }
              : {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => (actor.getSnapshot().matches('on') ? { status: 'handled', run: () => actor.send(command.event) } : { status: 'pass' }),
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
