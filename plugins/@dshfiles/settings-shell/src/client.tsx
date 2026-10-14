import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { resolveSlotLabel, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useApiQuery } from '@dshfiles/dshx/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { registerPaletteAction } from '@dshfiles/command-palette/api'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import { DesktopUpdateBadge, DesktopUpdateSource, desktopUpdateBridge } from './native/desktop-update.js'
import { SettingsDocumentAction, SettingsDocumentStore } from './native/document-action.js'
import { CloseLabel, CurrentVersionRow, DeveloperToolsRow, GeneralSection, HeaderContent, TriggerContent } from './native/general-section.js'
import { SHELL_LOCALE_NAMESPACE, shellLocale, type ShellTranslate } from './native/locales.js'
import { ShellRoot, type OnboardingStep, type ShellRootDeps } from './native/shell-root.js'
import { SHELL_CHILDREN, type ShellRenderSlot } from './native/slots.js'
import { useObservable } from './native/use-observable.js'
import { settingsShellApi } from './shell-api.js'
import { OPEN_SETTINGS_EVENT, openSettingsRequestSchema } from './open-settings.js'
import { preferredSurface } from './settings-preference.js'
import { SettingsDialog, SettingsTab, type SectionRow } from './settings-view.js'
import { shellMachine, type ShellSurface } from './shell-machine.js'
import { PORTED_FROM } from './upstream.js'
import './client.css'

/** The settings namespace whose acknowledgement the native welcome step stores; it is served by the native row only. */
const WELCOME_NOTICE_NAMESPACE = 'ui-settings-general'
const WELCOME_NOTICE_STEP = 'welcome-notice'
/** The main panel Settings fills when it opens as a tab; main-tabs names the tab "Settings" from this id. */
const SETTINGS_PANEL_ID = 'dshfiles-settings'
const SETTINGS_NAMESPACE = 'dshfiles-settings-shell'
const MAIN_TABS_OVERLAY_ID = 'dshfiles-main-tabs'
const OPEN_SETTINGS_COMMAND = 'settings.open'

const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)

const shortcutCommandId = (value: string): ShortcutCommandId => {
  if (!isShortcutCommandId(value)) throw new Error(`settings-shell: invalid shortcut command id ${value}`)
  return value
}

/**
 * The Client `connection` service. Its Context property is typed by the Host half of the same package (the dshx Host
 * runtime imports it), so the browser face is decoded once here.
 */
const clientConnectionShape = z.object({ reconnect: z.function(), state: z.object({ getSnapshot: z.function(), subscribe: z.function() }) })
/** `z.custom` keeps the service's own reference: `z.object` would hand back a copy whose methods lose their `this`. */
const clientConnectionSchema = z.custom<ConnectionHandle>(value => clientConnectionShape.safeParse(value).success)

/** A cached projection over one slot ledger that changes only when the ledger or the locale moves. */
const ledgerProjection = <T,>(read: () => T, versionOf: () => string, subscribe: (listener: () => void) => () => void): ObservableSnapshot<T> => {
  let version: string | undefined
  let value: T
  return {
    getSnapshot: () => {
      const next = versionOf()
      if (next !== version) {
        version = next
        value = read()
      }
      return value
    },
    subscribe,
  }
}

const CurrentVersion = (props: { readonly t: ShellTranslate }): JSX.Element => {
  const upstream = useApiQuery(settingsShellApi, 'upstream', {})
  return <CurrentVersionRow t={props.t} version={upstream.data?.installed ?? PORTED_FROM.version} />
}

export default defineClient({
  name: '@dshfiles/settings-shell',
  locales: [shellLocale],
  inject: ['slots', 'connection', 'remote', 'remote.settings', 'configForms', 'shortcuts', 'sessions', 'layout'],
  setup(ctx, decorate) {
    const t = ctx.locale.bind(SHELL_LOCALE_NAMESPACE)
    const connection = clientConnectionSchema.parse(ctx.get('connection'))
    const openSettingsCommand = shortcutCommandId(OPEN_SETTINGS_COMMAND)

    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)
    const showPanel = (): void => {
      if (isMainPanelId(SETTINGS_PANEL_ID)) ctx.layout.selectPanel(SETTINGS_PANEL_ID)
    }
    const actor = createActor(shellMachine, { input: { ports: { showPanel, leavePanel: () => ctx.layout.selectPanel(null) } } })
    ctx.effect(() => {
      actor.start()
      return () => actor.stop()
    }, 'settings-shell: shell machine')
    const subscribeActor = (listener: () => void): (() => void) => {
      const subscription = actor.subscribe(listener)
      return () => subscription.unsubscribe()
    }
    const settingsOpen: ObservableSnapshot<boolean> = { getSnapshot: () => !actor.getSnapshot().matches('closed'), subscribe: subscribeActor }
    const activeSection: ObservableSnapshot<string | undefined> = { getSnapshot: () => actor.getSnapshot().context.sectionId, subscribe: subscribeActor }
    const surfaceState: ObservableSnapshot<'closed' | 'modal' | 'expanded' | 'tab'> = {
      getSnapshot: () => {
        const snapshot = actor.getSnapshot()
        if (snapshot.matches('tab')) return 'tab'
        if (snapshot.matches({ modal: 'expanded' })) return 'expanded'
        return snapshot.matches('modal') ? 'modal' : 'closed'
      },
      subscribe: subscribeActor,
    }

    // Settings follows the main view: a Settings tab picked in the strip, or a reload landing on it, opens it there.
    ctx.effect(() => {
      const report = (): void => actor.send({ type: ctx.layout.panelInfo.getSnapshot().activePanelId === SETTINGS_PANEL_ID ? 'panel.shown' : 'panel.hidden' })
      const dispose = ctx.layout.panelInfo.subscribe(report)
      report()
      return dispose
    }, 'settings-shell: follow the main view')

    const preferences = ctx.configForms.get<unknown>(SETTINGS_NAMESPACE)
    const surface = (): ShellSurface =>
      preferredSurface({
        settings: preferences.getSnapshot().value,
        tabsLoaded: ctx.slots.entriesOfSlot('shell.overlay').some(entry => entry.options.id === MAIN_TABS_OVERLAY_ID),
      })
    const openSettings = (sectionId?: string): void =>
      actor.send(sectionId === undefined ? { type: 'open', surface: surface() } : { type: 'open', surface: surface(), sectionId })

    let panelHost: HTMLElement | null = null
    const hostListeners = new Set<() => void>()
    const mainPanelHost: ObservableSnapshot<HTMLElement | null> = {
      getSnapshot: () => panelHost,
      subscribe: listener => {
        hostListeners.add(listener)
        return () => hostListeners.delete(listener)
      },
    }
    const setPanelHost = (element: HTMLElement | null): void => {
      panelHost = element
      hostListeners.forEach(listener => listener())
    }

    const desktopUpdate = new DesktopUpdateSource(desktopUpdateBridge())
    ctx.effect(() => () => desktopUpdate.dispose(), 'settings-shell: desktop update carrier')

    const sections = ledgerProjection<readonly SectionRow[]>(
      () =>
        ctx.slots
          .entries('settings.section')
          .map(entry => ({ id: entry.options.id ?? '', order: entry.options.order ?? 0, label: resolveSlotLabel(entry.options.label) ?? '' }))
          .sort((left, right) => left.order - right.order),
      () => `${ctx.slots.getVersion('settings.section')}:${ctx.locale.getSnapshot().revision}`,
      listener => {
        const offLedger = ctx.slots.subscribe('settings.section', listener)
        const offLocale = ctx.locale.subscribe(listener)
        return () => {
          offLedger()
          offLocale()
        }
      },
    )
    const onboardingSteps = ledgerProjection<readonly OnboardingStep[]>(
      () =>
        ctx.slots
          .entries('settings.onboarding')
          .map(entry => ({ id: entry.options.id ?? '', order: entry.options.order ?? 0 }))
          .sort((left, right) => left.order - right.order),
      () => String(ctx.slots.getVersion('settings.onboarding')),
      listener => ctx.slots.subscribe('settings.onboarding', listener),
    )
    const onboardingActive: ObservableSnapshot<boolean> = {
      getSnapshot: () => {
        const state = ctx.sessions.list.getSnapshot()
        const main = Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)
        return state.phase === 'ready' && (main === undefined || main.blank)
      },
      subscribe: listener => ctx.sessions.list.subscribe(listener),
    }
    // The welcome step stores its acknowledgement in the native row's namespace, which is switched off with that row; an
    // unserved namespace would only show the notice with a save error on every empty Hero, so it is skipped instead.
    const welcomeForm = ctx.configForms.get<unknown>(WELCOME_NOTICE_NAMESPACE)
    const noSkips: ReadonlySet<string> = new Set()
    const welcomeSkipped: ReadonlySet<string> = new Set([WELCOME_NOTICE_STEP])
    const skippedOnboarding: ObservableSnapshot<ReadonlySet<string>> = {
      getSnapshot: () => (welcomeForm.getSnapshot().status === 'unavailable' ? welcomeSkipped : noSkips),
      subscribe: listener => welcomeForm.subscribe(listener),
    }

    const mainTabsLoaded: ObservableSnapshot<boolean> = {
      getSnapshot: () => ctx.slots.entriesOfSlot('shell.overlay').some(entry => entry.options.id === MAIN_TABS_OVERLAY_ID),
      subscribe: listener => ctx.slots.subscribe('shell.overlay', listener),
    }

    const deps: ShellRootDeps = {
      connectionState: connection.state,
      reconnect: () => connection.reconnect(),
      desktopUpdate,
      shortcuts: ctx.shortcuts.catalog,
      onboardingSteps,
      onboardingActive,
      skippedOnboarding,
      settingsOpen,
      openSettings: () => openSettings(),
      closeSettings: () => actor.send({ type: 'close' }),
      openSection: sectionId => openSettings(sectionId),
    }

    const Surface = (props: { readonly renderSlot: ShellRenderSlot; readonly t: ShellTranslate }): JSX.Element | null => {
      const rows = useObservable(sections)
      const activeId = useObservable(activeSection)
      const variant = useObservable(surfaceState)
      const host = useObservable(mainPanelHost)
      const tabsLoaded = useObservable(mainTabsLoaded)
      if (variant === 'closed') return null
      const view = {
        rows,
        activeId,
        renderSlot: props.renderSlot,
        sectionOwner: { close: deps.closeSettings },
        t: props.t,
        onSelect: (sectionId: string) => actor.send({ type: 'select', sectionId }),
        onExpand: () => actor.send({ type: 'expand' }),
        onRestore: () => actor.send({ type: 'restore' }),
        onMoveToTab: () => actor.send({ type: 'moveToTab' }),
      }
      if (variant !== 'tab') return <SettingsDialog {...view} onClose={deps.closeSettings} variant={variant} />
      if (host === null) return null
      // With main-tabs the strip closes the tab; without it the header keeps a way back to the previous view.
      return <SettingsTab {...view} host={host} onClose={tabsLoaded ? undefined : deps.closeSettings} variant="tab" />
    }

    ctx.slots.inject('sidebar.settings', () => {
      const disposeCommand = ctx.shortcuts.register({
        id: openSettingsCommand,
        label: () => t('shortcut.open'),
        aliases: ['settings', 'preferences'],
        defaults: {
          'desktop:macos': { code: 'Comma', modifiers: ['primary'] },
          'desktop:windows': { code: 'Comma', modifiers: ['primary'] },
          'desktop:linux': { code: 'Comma', modifiers: ['primary'] },
          'web:macos': { code: 'Comma', modifiers: ['primary', 'alt'] },
          'web:windows': { code: 'Comma', modifiers: ['primary', 'alt'] },
        },
        regions: ['page', 'editable', 'terminal'],
        modals: ['settings'],
        resolve: ({ modal }) => {
          if (modal !== null && modal !== 'settings') return { status: 'blocked', reason: 'modal' }
          return {
            status: 'handled',
            run: () => {
              if (modal === 'settings') closeTopModal(document)
              else if (actor.getSnapshot().matches('tab')) deps.closeSettings()
              else deps.openSettings()
            },
          }
        },
      })
      const disposeSlot = ctx.slots.register(
        { name: 'sidebar.settings', locale: SHELL_LOCALE_NAMESPACE, children: SHELL_CHILDREN },
        decorate((props: { readonly wide: boolean; readonly t: ShellTranslate; readonly renderSlot: ShellRenderSlot }) => (
          <ShellRoot deps={deps} renderSlot={props.renderSlot} surface={<Surface renderSlot={props.renderSlot} t={props.t} />} t={props.t} wide={props.wide} />
        )),
      )
      return () => {
        disposeCommand()
        disposeSlot()
      }
    })

    const PanelHost = (): JSX.Element => {
      const [element, setElement] = useState<HTMLDivElement | null>(null)
      useEffect(() => {
        setPanelHost(element)
        return () => setPanelHost(null)
      }, [element])
      return <div className="dshx:h-full dshx:min-h-0 dshx:w-full" data-settings-panel-host="" ref={setElement} />
    }
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SETTINGS_PANEL_ID }, PanelHost))

    ctx.effect(() => {
      const onOpenSettings = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const request = openSettingsRequestSchema.safeParse(event.detail ?? {})
        if (!request.success) return
        event.preventDefault()
        const requested = request.data.surface ?? surface()
        actor.send(
          request.data.section === undefined ? { type: 'open', surface: requested } : { type: 'open', surface: requested, sectionId: request.data.section },
        )
      }
      window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
      return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
    }, 'settings-shell: open-settings requests')

    ctx.effect(() => {
      let registered: Array<() => void> = []
      const register = (): void => {
        registered.forEach(dispose => dispose())
        registered = [
          registerPaletteAction({
            id: '@dshfiles/settings-shell/open',
            label: () => t('palette.open'),
            aliases: ['settings', 'preferences', 'options'],
            group: 'command',
            run: () => openSettings(),
          }),
          ...sections.getSnapshot().map(row =>
            registerPaletteAction({
              id: `@dshfiles/settings-shell/section/${row.id}`,
              label: () => t('palette.section', { section: row.label }),
              aliases: ['settings', 'preferences'],
              group: 'command',
              run: () => openSettings(row.id),
            }),
          ),
        ]
      }
      const dispose = sections.subscribe(register)
      register()
      return () => {
        dispose()
        registered.forEach(release => release())
      }
    }, 'settings-shell: palette actions')

    ctx.slots.inject('sidebar.toggle.badge', () =>
      ctx.slots.register({ name: 'sidebar.toggle.badge', locale: SHELL_LOCALE_NAMESPACE }, (props: { readonly t: ShellTranslate }) => (
        <DesktopUpdateBadge connectionState={useObservable(connection.state)} source={desktopUpdate} t={props.t} />
      )),
    )

    ctx.slots.inject('settings.trigger', () =>
      ctx.slots.register({ name: 'settings.trigger', locale: SHELL_LOCALE_NAMESPACE }, (props: { readonly wide: boolean; readonly t: ShellTranslate }) => (
        <TriggerContent t={props.t} wide={props.wide} />
      )),
    )
    ctx.slots.inject('settings.header', () =>
      ctx.slots.register({ name: 'settings.header', locale: SHELL_LOCALE_NAMESPACE }, (props: { readonly t: ShellTranslate }) => <HeaderContent t={props.t} />),
    )
    ctx.slots.inject('settings.close', () =>
      ctx.slots.register({ name: 'settings.close', locale: SHELL_LOCALE_NAMESPACE }, (props: { readonly t: ShellTranslate }) => <CloseLabel t={props.t} />),
    )

    if (ctx.remote.$host.isLoopback) {
      const documentController = new SettingsDocumentStore(ctx.configForms.describe(), () => ctx.remote.settings.openSettingsDocument())
      ctx.effect(() => () => documentController.dispose(), 'settings-shell: document action')
      ctx.slots.inject('settings.action', () =>
        ctx.slots.register(
          { name: 'settings.action', id: 'open-document', order: 0, locale: SHELL_LOCALE_NAMESPACE },
          (props: { readonly t: ShellTranslate }) => <SettingsDocumentAction controller={documentController} t={props.t} />,
        ),
      )
    }

    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'general',
          order: 0,
          label: () => t('general.nav'),
          locale: SHELL_LOCALE_NAMESPACE,
          children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
        },
        (props: PropsRenderSlots<'settings.general.item'>) => <GeneralSection renderSlot={props.renderSlot} />,
      ),
    )
    ctx.slots.inject('settings.general.item', () =>
      ctx.slots.register(
        { name: 'settings.general.item', id: 'developer-tools', order: 15, locale: SHELL_LOCALE_NAMESPACE },
        (props: { readonly t: ShellTranslate }) => (
          <DeveloperToolsRow
            enabled={ctx.configForms.developerTools.enabled}
            setEnabled={enabled => ctx.configForms.developerTools.setEnabled(enabled)}
            t={props.t}
          />
        ),
      ),
    )
    ctx.slots.inject('settings.general.item', () =>
      ctx.slots.register(
        { name: 'settings.general.item', id: 'current-version', order: 100, locale: SHELL_LOCALE_NAMESPACE },
        decorate((props: { readonly t: ShellTranslate }) => <CurrentVersion t={props.t} />),
      ),
    )
  },
})
