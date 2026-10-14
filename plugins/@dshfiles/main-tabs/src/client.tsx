import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient, useSettings } from '@dshfiles/dshx/client'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { readHostView } from './host-target.js'
import { MAIN_TABS_LOCALE_NAMESPACE, mainTabsLocale } from './locales.js'
import { mainTabsSettings } from './settings.js'
import { TabStrip, threadTabStatus, type TabView } from './tab-strip.js'
import { DEFAULT_TAB_PREFERENCES, tabIdOf, tabsMachine, type TabPreferences, type TabsEvent, type TabTarget } from './tabs-machine.js'
import { saveTabs, storedTabs } from './tabs-storage.js'
import './client.css'

const HOST_ATTRIBUTE = 'data-dshfiles-main-tabs'

const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)

/** "dshfiles-multi-host-thread" → "Multi host thread", for a main panel without a sidebar entry to name it. */
const panelTitleFallback = (panelId: string): string => {
  const words = panelId.replace(/^dshfiles-/u, '').replaceAll(/[-_.]+/gu, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The frame has no seat above the main panel, so the strip lives in a node we prepend to the centre column (a flex
 * column) and fills with a portal. React only ever appends its own panel after it, so the node survives panel changes.
 */
const useMainColumnHost = (): HTMLElement | null => {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let created: HTMLElement | null = null
    const attach = (): boolean => {
      const column = document.querySelector('[data-rightbar-col]')?.previousElementSibling
      if (!(column instanceof HTMLElement)) return false
      const existing = column.querySelector(`:scope > [${HOST_ATTRIBUTE}]`)
      if (existing instanceof HTMLElement) {
        setHost(existing)
        return true
      }
      created = document.createElement('div')
      created.setAttribute(HOST_ATTRIBUTE, '')
      created.style.display = 'contents'
      column.prepend(created)
      setHost(created)
      return true
    }
    if (attach()) return () => created?.remove()
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      created?.remove()
    }
  }, [])
  return host
}

export default defineClient({
  name: '@dshfiles/main-tabs',
  locales: [mainTabsLocale],
  inject: ['slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'shortcuts'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(MAIN_TABS_LOCALE_NAMESPACE)

    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)

    const navigate = (target: TabTarget): boolean => {
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
          const host = useMainColumnHost()

          const set = snapshot.context.sets[snapshot.context.scopeKey]
          const tabs = (set?.tabs ?? []).map((tab): TabView => {
            const base = { id: tab.id, active: tab.id === set?.activeTabId, pinned: tab.pinned, preview: tab.preview }
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

          if (host === null || !snapshot.matches('on') || tabs.length === 0) return null
          return createPortal(<TabStrip tabs={tabs} send={event => actor.send(event)} t={props.t} />, host)
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
