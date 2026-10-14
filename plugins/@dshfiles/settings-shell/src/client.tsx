import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { resolveSlotLabel, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createApiClient, defineClient, provideSettingsPageRenderer, useApiQuery, type SettingsPageRendererProps } from '@dshfiles/dshx/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { registerPaletteAction } from '@dshfiles/command-palette/api'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

import { DesktopUpdateBadge, DesktopUpdateSource, desktopUpdateBridge } from './native/desktop-update.js'
import { SettingsDocumentStore } from './native/document-action.js'
import { OpenConfigAction, type ConfigFileOpeners } from './open-config-action.js'
import { CloseLabel, CurrentVersionRow, DeveloperToolsRow, GeneralSection, HeaderContent, TriggerContent } from './native/general-section.js'
import { SHELL_LOCALE_NAMESPACE, shellLocale, type ShellTranslate } from './native/locales.js'
import { ShellRoot, type OnboardingStep, type ShellRootDeps } from './native/shell-root.js'
import { SHELL_CHILDREN, type ShellRenderSlot } from './native/slots.js'
import { useObservable } from './native/use-observable.js'
import { settingsShellApi } from './shell-api.js'
import { OPEN_SETTINGS_EVENT, openSettingsRequestSchema, type OpenSettingsRequest } from './open-settings.js'
import { PluginSettingsPageView } from './plugin-settings-page.js'
import type { SettingField } from './schema-form/schema-model.js'
import { SettingsForm } from './schema-form/settings-form.js'
import { localizedTextReader, pluginPageId, pluginSettingsPages, type NamespaceLabel, type PluginSettingsPage } from './plugin-settings.js'
import { preferredSurface } from './settings-preference.js'
import { SettingsDialog, SettingsTab, type SectionRow } from './settings-view.js'
import { shellMachine, type FieldTarget, type ShellSurface } from './shell-machine.js'
import { PORTED_FROM } from './upstream.js'
import './client.css'

/** The settings namespace whose acknowledgement the native welcome step stores; it is served by the native row only. */
const WELCOME_NOTICE_NAMESPACE = 'ui-settings-general'
const WELCOME_NOTICE_STEP = 'welcome-notice'
/** The main panel Settings fills when it opens as a tab; main-tabs names the tab "Settings" from this id. */
const SETTINGS_PANEL_ID = 'dshfiles-settings'
const SETTINGS_NAMESPACE = 'dshfiles-settings-shell'
const MAIN_TABS_OVERLAY_ID = 'dshfiles-main-tabs'
/** The Editor plugin's right-pane tab and its cross-plugin open request (`@dshfiles/editor` README). */
const EDITOR_PANE_ID = '@dshfiles/editor/files'
const OPEN_FILE_EVENT = 'dshfiles:open-file'
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
  inject: ['slots', 'connection', 'remote', 'remote.settings', 'remote.session', 'configForms', 'shortcuts', 'sessions', 'layout'],
  setup(ctx, decorate, metadata) {
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

    // Bundle manifests title each namespace ("Thread Sidebar" for `thread-sidebar`); read once Settings first opens.
    const labels = createSnapshotStore<ReadonlyMap<string, NamespaceLabel>>(new Map())
    let labelsRequested = false
    ctx.inject(['remote.pluginManager'], scoped => {
      const load = (): void => {
        void scoped.remote.pluginManager.listBundles().then(result => {
          if (!result.ok) return
          const next = new Map<string, NamespaceLabel>()
          for (const bundle of result.value) {
            for (const row of bundle.rows) {
              // A package name is no title; without manifest text the page falls back to the schema or the id.
              const title = row.meta?.title ?? bundle.meta?.title
              const description = row.meta?.description ?? bundle.meta?.description
              const resolvedTitle = title === undefined ? '' : ctx.locale.resolveText(title)
              next.set(row.rowId, {
                title: resolvedTitle === bundle.name || resolvedTitle === row.moduleName ? '' : resolvedTitle,
                description: description === undefined ? (bundle.description ?? '') : ctx.locale.resolveText(description),
              })
            }
          }
          labels.set(next)
        })
      }
      const dispose = subscribeActor(() => {
        if (labelsRequested || !settingsOpen.getSnapshot()) return
        labelsRequested = true
        load()
      })
      scoped.effect(() => dispose, 'settings-shell: bundle labels')
    })

    const describe = ctx.configForms.describe()
    // Snapshot identities change exactly when the data does; counting them keys the page projection.
    const identityVersion = <T,>(read: () => T): (() => number) => {
      let last: T | undefined
      let version = 0
      return () => {
        const current = read()
        if (current !== last) {
          last = current
          version += 1
        }
        return version
      }
    }
    const describeVersion = identityVersion(() => describe.getSnapshot())
    const labelsVersion = identityVersion(() => labels.getSnapshot())
    const pluginPages = ledgerProjection<readonly PluginSettingsPage[]>(
      () =>
        pluginSettingsPages({
          namespaces: describe.getSnapshot().view?.namespaces ?? [],
          labels: labels.getSnapshot(),
          text: localizedTextReader(ctx.locale.getSnapshot().active),
        }),
      () => `${String(describe.getSnapshot().view?.namespaces.length)}:${ctx.locale.getSnapshot().revision}:${labelsVersion()}:${describeVersion()}`,
      listener => {
        const offDescribe = describe.subscribe(listener)
        const offLabels = labels.subscribe(listener)
        const offLocale = ctx.locale.subscribe(listener)
        return () => {
          offDescribe()
          offLabels()
          offLocale()
        }
      },
    )

    /** Opens the page that edits one settings field; false when no served namespace has it. */
    const openSettingsTarget = (target: { readonly entryId: string; readonly fieldPath: readonly string[] }, requested?: ShellSurface): boolean => {
      void describe.ensure()
      const page = pluginPages.getSnapshot().find(candidate => candidate.ns === target.entryId)
      if (page === undefined) return false
      const field: FieldTarget = { sectionId: pluginPageId(page.ns), fieldPath: target.fieldPath }
      actor.send({ type: 'open', surface: requested ?? surface(), field })
      return true
    }

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

    const fieldTarget: ObservableSnapshot<FieldTarget | undefined> = { getSnapshot: () => actor.getSnapshot().context.field, subscribe: subscribeActor }
    const searchQuery: ObservableSnapshot<string> = { getSnapshot: () => actor.getSnapshot().context.query, subscribe: subscribeActor }
    // Sections get the native `close` plus the navigation the dshx Settings-target contract describes.
    const sectionOwner: SettingsSectionOwnerProps & {
      readonly openSection: (sectionId: string) => void
      readonly openSettingsTarget: (target: { readonly entryId: string; readonly fieldPath: readonly string[] }) => boolean
    } = {
      close: () => actor.send({ type: 'close' }),
      openSection: sectionId => openSettings(sectionId),
      openSettingsTarget: target => openSettingsTarget(target),
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
      const pages = useObservable(pluginPages)
      const field = useObservable(fieldTarget)
      const query = useObservable(searchQuery)
      useEffect(() => {
        void describe.ensure()
      }, [])
      const tabsLoaded = useObservable(mainTabsLoaded)
      if (variant === 'closed') return null
      const view = {
        rows,
        activeId,
        renderSlot: props.renderSlot,
        pluginPages: pages,
        renderPluginPage: (page: PluginSettingsPage) => (
          <PluginSettingsPageView
            form={ctx.configForms.get<unknown>(page.ns)}
            key={page.ns}
            page={page}
            t={props.t}
            {...(field?.sectionId === page.pageId ? { focusPath: field.fieldPath } : {})}
          />
        ),
        sectionOwner,
        t: props.t,
        onSelect: (sectionId: string) => actor.send({ type: 'select', sectionId }),
        query,
        onSearch: (next: string) => actor.send({ type: 'search', query: next }),
        renderMatches: (page: PluginSettingsPage, fields: readonly SettingField[], highlight: string) => (
          <SettingsForm fields={fields} form={ctx.configForms.get<unknown>(page.ns)} highlight={highlight} key={page.ns} t={props.t} />
        ),
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

    // Every dshx plugin's own Plugins page draws its settings with the same controls as Settings.
    const PluginsPageSettings = (props: SettingsPageRendererProps): JSX.Element | null => {
      const pages = useObservable(pluginPages).filter(page => props.namespaces.includes(page.ns))
      useEffect(() => {
        void describe.ensure()
      }, [])
      if (pages.length === 0) return null
      return (
        <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-4" data-settings-shell-plugin-page={props.packageId}>
          {pages.map(page => (
            <section aria-label={page.title} className="dshx:flex dshx:flex-col" key={page.ns}>
              {pages.length > 1 && <h4 className="dshx:m-0 dshx:text-[13px] dshx:font-semibold dshx:text-muted-foreground">{page.title}</h4>}
              <SettingsForm fields={page.fields} form={ctx.configForms.get<unknown>(page.ns)} t={t} />
            </section>
          ))}
        </div>
      )
    }
    ctx.effect(() => provideSettingsPageRenderer(PluginsPageSettings), 'settings-shell: Plugins page settings')

    const openRequest = (request: OpenSettingsRequest): void => {
      const requested = request.surface ?? surface()
      if (request.setting !== undefined && openSettingsTarget(request.setting, requested)) return
      actor.send(request.section === undefined ? { type: 'open', surface: requested } : { type: 'open', surface: requested, sectionId: request.section })
      if (request.query !== undefined) actor.send({ type: 'search', query: request.query })
    }

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
        openRequest(request.data)
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

    // Native policy: only a loopback page gets the privileged document actions (and the path they reveal).
    if (ctx.remote.$host.isLoopback) {
      const documentController = new SettingsDocumentStore(ctx.configForms.describe(), () => ctx.remote.settings.openSettingsDocument())
      ctx.effect(() => () => documentController.dispose(), 'settings-shell: document action')
      const api = createApiClient(ctx, settingsShellApi, metadata?.packageId)
      const editorLoaded = (): boolean => ctx.slots.entries('sidebar.right.pane.tab').some(entry => entry.options.key === EDITOR_PANE_ID)
      const openers: ConfigFileOpeners = {
        documentPath: async () => {
          const result = await api.safe.documentPath(undefined)
          return result.ok && result.value.path !== null ? { path: result.value.path, exists: result.value.exists } : null
        },
        canOpenPaths: async () => {
          const result = await ctx.remote.session.canOpenWorkspacePath()
          return result.ok && result.value
        },
        applications: async path => {
          const result = await ctx.remote.session.workspacePathApplications({ path })
          return result.ok ? result.value : null
        },
        openWith: async (path, application) => (await ctx.remote.session.openWorkspacePath({ path, application })).ok,
        reveal: async path => (await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' })).ok,
        openInEditor: path => {
          if (!editorLoaded()) return false
          const handled = !window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: { path }, cancelable: true }))
          if (handled && actor.getSnapshot().matches('modal')) actor.send({ type: 'close' })
          return handled
        },
      }
      ctx.slots.inject('settings.action', () =>
        ctx.slots.register(
          { name: 'settings.action', id: 'open-document', order: 0, locale: SHELL_LOCALE_NAMESPACE },
          (props: { readonly t: ShellTranslate }) => <OpenConfigAction controller={documentController} openers={openers} t={props.t} />,
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
