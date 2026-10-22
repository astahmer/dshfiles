import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientReleaseChange } from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { resolveSlotLabel, type PropsRenderSlots, type PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createApiClient, defineClient, provideSettingsPageRenderer, useApiQuery, type SettingsPageRendererProps } from '@dshfiles/dshx/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { PaletteApi } from '@dshfiles/command-palette/api'
import { SettingsIcon } from '@dshfiles/plugin-ui/icons'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { ConfigForm, SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

import { DesktopUpdateBadge, DesktopUpdateSource, desktopUpdateBridge } from './native/desktop-update.js'
import { SettingsDocumentStore } from './native/document-action.js'
import { OpenConfigAction, type ConfigFileOpeners } from './open-config-action.js'
import { CloseLabel, CurrentVersionRow, DeveloperToolsRow, GeneralSection, HeaderContent, TriggerContent } from './native/general-section.js'
import { HostReleasePrompt } from './native/host-release-prompt.js'
import { SHELL_LOCALE_NAMESPACE, shellLocale, type ShellTranslate } from './native/locales.js'
import { ShellRoot, type OnboardingStep, type ShellRootDeps } from './native/shell-root.js'
import { SHELL_CHILDREN, type ShellRenderSlot } from './native/slots.js'
import { useObservable } from './native/use-observable.js'
import { WELCOME_LOCALE_NAMESPACE, WELCOME_STEP_ID, WelcomeNotice, WelcomeNoticeStore, welcomeLocale, type WelcomeTranslate } from './native/welcome-notice.js'
import { settingsShellApi } from './shell-api.js'
import { OPEN_SETTINGS_EVENT, openSettingsRequestSchema, type OpenSettingsRequest } from './open-settings.js'
import { PluginSettingsPageView } from './plugin-settings-page.js'
import type { SettingField } from './schema-form/schema-model.js'
import { SettingsForm } from './schema-form/settings-form.js'
import { SettingsPluginPages, type NamespaceLabel, type PluginSettingsPage } from './plugin-settings.js'
import { preferredSurface, type SettingsSurface } from './settings-preference.js'
import { SettingsDialog, SettingsSidePanel, SettingsTab, type SectionRow, type SettingsViewProps } from './settings-view.js'
import { shellMachine, type FieldTarget } from './shell-machine.js'
import { PORTED_FROM } from './upstream.js'

/** The main panel Settings fills when it opens as a tab; main-tabs names the tab "Settings" from this id. */
const SETTINGS_PANEL_ID = 'dshfiles-settings'
const SETTINGS_NAMESPACE = 'dshfiles-settings-shell'
const MAIN_TABS_OVERLAY_ID = 'dshfiles-main-tabs'
/** The Editor plugin's right-pane tab and its cross-plugin open request (`@dshfiles/editor` README). */
const EDITOR_PANE_ID = '@dshfiles/editor/files'
const OPEN_FILE_EVENT = 'dshfiles:open-file'
const OPEN_SETTINGS_COMMAND = 'settings.open'
/** The right-sidebar tab type Settings opens as; the panel's guide offers it beside the other panel cards. */
const SETTINGS_SIDEBAR_TAB_ID = '@dshfiles/settings-shell/side-panel'
const SETTINGS_SIDEBAR_KIND = 'dshfiles-settings-panel'
/** `@dshfiles/main-tabs` asks this for the side-panel Settings tab when its main tab is dropped there. */
const PANEL_ASIDE_EVENT = 'dshfiles:move-panel-aside'
const panelAsideRequestSchema = z.object({ panelId: z.string().min(1) }).strict()

/** A frame's portal target: the element the panel or the side panel currently renders, or null while unmounted. */
interface HostSlot {
  readonly observable: ObservableSnapshot<HTMLElement | null>
  readonly set: (element: HTMLElement | null) => void
}
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
  return (
    <>
      <CurrentVersionRow t={props.t} version={upstream.data?.installed ?? PORTED_FROM.version} />
      {upstream.data?.stale === true && (
        <p className="dshx:m-0 dshx:pb-4 dshx:text-[12px] dshx:text-warning" role="note">
          {props.t('port.stale', { ported: upstream.data.portedFrom, installed: upstream.data.installed ?? '' })}
        </p>
      )}
    </>
  )
}

export default defineClient({
  name: '@dshfiles/settings-shell',
  locales: [shellLocale, welcomeLocale],
  inject: [
    'slots',
    'connection',
    'remote',
    'remote.settings',
    'remote.session',
    'configForms',
    'shortcuts',
    'sessions',
    'layout',
    'modules',
    'sidebarRight',
    'sidebarRightTabs',
  ],
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
    // A Host write lands seconds later; the next gear click should already follow the `openIn` just picked.
    let requestedOpenIn: unknown
    const ownForm: ConfigForm<unknown> = {
      getSnapshot: () => preferences.getSnapshot(),
      subscribe: listener => preferences.subscribe(listener),
      set: (field, value) => preferences.set(field, value),
      unset: field => preferences.unset(field),
      mutate: (ops, expectedRevision) => {
        const edit = ops.find(op => op.path.length === 1 && op.path[0] === 'openIn')
        if (edit === undefined) return preferences.mutate(ops, expectedRevision)
        const requested = edit.op === 'set' ? edit.value : undefined
        requestedOpenIn = requested
        return preferences.mutate(ops, expectedRevision).finally(() => {
          if (requestedOpenIn === requested) requestedOpenIn = undefined
        })
      },
    }
    const formFor = (ns: string): ConfigForm<unknown> => (ns === SETTINGS_NAMESPACE ? ownForm : ctx.configForms.get<unknown>(ns))
    const surface = (): SettingsSurface =>
      preferredSurface({
        settings: requestedOpenIn === undefined ? preferences.getSnapshot().value : { openIn: requestedOpenIn },
        tabsLoaded: ctx.slots.entriesOfSlot('shell.overlay').some(entry => entry.options.id === MAIN_TABS_OVERLAY_ID),
      })
    /** The right-sidebar tab showing Settings, when the panel's active tab is ours. */
    const sidebarSettingsTab = (): ReturnType<typeof ctx.sidebarRight.active> => {
      const tab = ctx.sidebarRight.active()
      return tab?.kind === SETTINGS_SIDEBAR_KIND ? tab : undefined
    }
    /** Open (or focus) Settings in the side panel; a dialog left over from the other surface would float above it. */
    const openSidePanelSettings = (sectionId?: string, field?: FieldTarget): void => {
      if (field !== undefined) actor.send({ type: 'focus', field })
      else if (sectionId !== undefined) actor.send({ type: 'select', sectionId })
      if (actor.getSnapshot().matches('modal')) actor.send({ type: 'close' })
      ctx.sidebarRight.openTab(SETTINGS_SIDEBAR_KIND)
    }
    const openSettings = (sectionId?: string): void => {
      const next = surface()
      if (next === 'sidebar') {
        openSidePanelSettings(sectionId)
        return
      }
      actor.send(sectionId === undefined ? { type: 'open', surface: next } : { type: 'open', surface: next, sectionId })
    }

    // Settings has a main page and a side-panel tab. Moving between them is this plugin's business, so it answers the
    // strip's request and offers the reverse row on its own side-panel tab.
    ctx.effect(() => {
      const onMovePanelAside = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const request = panelAsideRequestSchema.safeParse(event.detail)
        if (!request.success || request.data.panelId !== SETTINGS_PANEL_ID || ctx.sidebarRight.mounted.getSnapshot() === undefined) return
        event.preventDefault()
        openSidePanelSettings()
      }
      window.addEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
      return () => window.removeEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
    }, 'settings-shell: move settings into the side panel')
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.right.tab.menu.item', id: 'settings-shell-move-to-main', order: 10 },
            (props: PropsRuntime<'sidebar.right.tab.menu.item'>) => {
              if (props.tab.kind !== SETTINGS_SIDEBAR_KIND) return null
              return (
                <button
                  type="button"
                  role="menuitem"
                  className="dshx:flex dshx:w-full dshx:cursor-pointer dshx:items-center dshx:rounded-(--dsw-radius-md) dshx:border-none dshx:bg-transparent dshx:px-[7px] dshx:py-1 dshx:text-left dshx:text-[length:calc(var(--dsh-content-font-size-secondary,13px)-1px)] dshx:text-(--dsw-alias-label-primary) dshx:hover:bg-(--dsw-alias-interactive-bg-hover)"
                  onClick={() => {
                    props.dismiss()
                    if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.close(props.tab.id)
                    if (isMainPanelId(SETTINGS_PANEL_ID)) ctx.layout.selectPanel(SETTINGS_PANEL_ID)
                  }}
                >
                  {t('sidebar.moveToMain')}
                </button>
              )
            },
          ),
        ),
      'settings-shell: move the side-panel settings to the main view',
    )

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
        SettingsPluginPages.pluginSettingsPages({
          namespaces: describe.getSnapshot().view?.namespaces ?? [],
          labels: labels.getSnapshot(),
          text: SettingsPluginPages.localizedTextReader(ctx.locale.getSnapshot().active),
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
    const openSettingsTarget = (target: { readonly entryId: string; readonly fieldPath: readonly string[] }, requested?: SettingsSurface): boolean => {
      void describe.ensure()
      const page = pluginPages.getSnapshot().find(candidate => candidate.ns === target.entryId)
      if (page === undefined) return false
      const field: FieldTarget = { sectionId: SettingsPluginPages.pluginPageId(page.ns), fieldPath: target.fieldPath }
      const next = requested ?? surface()
      if (next === 'sidebar') {
        openSidePanelSettings(undefined, field)
        return true
      }
      actor.send({ type: 'open', surface: next, field })
      return true
    }

    /** One element a Settings frame portals into (the main panel, the side panel's tab): null while it is unmounted. */
    const hostSlot = (): HostSlot => {
      let element: HTMLElement | null = null
      const listeners = new Set<() => void>()
      return {
        observable: {
          getSnapshot: () => element,
          subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        },
        set: (next: HTMLElement | null) => {
          element = next
          listeners.forEach(listener => listener())
        },
      }
    }
    const mainPanelHostSlot = hostSlot()
    const sidePanelHostSlot = hostSlot()

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
        // Winners only: this plugin shadows the native welcome step under the same id.
        ctx.slots
          .entriesOfSlot('settings.onboarding')
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
      settingsOpen,
      openSettings: () => openSettings(),
      closeSettings: () => actor.send({ type: 'close' }),
      openSection: sectionId => openSettings(sectionId),
    }

    /** Everything a Settings frame shows, minus the frame and its close button: every surface shares one copy. */
    const settingsViewProps = (input: {
      readonly renderSlot: ShellRenderSlot
      readonly t: ShellTranslate
      readonly rows: readonly SectionRow[]
      readonly activeId: string | undefined
      readonly pluginPages: readonly PluginSettingsPage[]
      readonly field: FieldTarget | undefined
      readonly query: string
    }): Omit<SettingsViewProps, 'variant' | 'onClose'> => ({
      rows: input.rows,
      activeId: input.activeId,
      renderSlot: input.renderSlot,
      pluginPages: input.pluginPages,
      renderPluginPage: (page: PluginSettingsPage) => (
        <PluginSettingsPageView
          form={formFor(page.ns)}
          key={page.ns}
          page={page}
          t={input.t}
          {...(input.field?.sectionId === page.pageId ? { focusPath: input.field.fieldPath } : {})}
        />
      ),
      renderMatches: (page: PluginSettingsPage, fields: readonly SettingField[], highlight: string) => (
        <SettingsForm fields={fields} form={formFor(page.ns)} highlight={highlight} key={page.ns} namespace={page.ns} t={input.t} />
      ),
      sectionOwner,
      t: input.t,
      onSelect: (sectionId: string) => actor.send({ type: 'select', sectionId }),
      onSearch: (next: string) => actor.send({ type: 'search', query: next }),
      // Only the side panel drills in and out of sections; the other frames leave `onBack` unused.
      onBack: () => actor.send({ type: 'back' }),
      onExpand: () => actor.send({ type: 'expand' }),
      onRestore: () => actor.send({ type: 'restore' }),
      onMoveToTab: () => actor.send({ type: 'moveToTab' }),
      query: input.query,
    })

    const Surface = (props: { readonly renderSlot: ShellRenderSlot; readonly t: ShellTranslate }): JSX.Element | null => {
      const rows = useObservable(sections)
      const activeId = useObservable(activeSection)
      const variant = useObservable(surfaceState)
      const host = useObservable(mainPanelHostSlot.observable)
      const sidePanelHost = useObservable(sidePanelHostSlot.observable)
      const pages = useObservable(pluginPages)
      const field = useObservable(fieldTarget)
      const query = useObservable(searchQuery)
      useEffect(() => {
        void describe.ensure()
      }, [])
      const tabsLoaded = useObservable(mainTabsLoaded)
      const view = settingsViewProps({ renderSlot: props.renderSlot, t: props.t, rows, activeId, pluginPages: pages, field, query })
      // The side panel owns its frame: it renders whenever its tab is mounted, whatever the dialog or main view shows.
      const sidePanel = sidePanelHost === null ? null : <SettingsSidePanel {...view} host={sidePanelHost} onClose={undefined} variant="sidebar" />
      if (variant === 'closed') return sidePanel
      if (variant !== 'tab')
        return (
          <>
            {sidePanel}
            <SettingsDialog {...view} onClose={deps.closeSettings} variant={variant} />
          </>
        )
      if (host === null) return sidePanel
      // With main-tabs the strip closes the tab; without it the header keeps a way back to the previous view.
      return (
        <>
          {sidePanel}
          <SettingsTab {...view} host={host} onClose={tabsLoaded ? undefined : deps.closeSettings} variant="tab" />
        </>
      )
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
              const sidebarTab = sidebarSettingsTab()
              if (modal === 'settings') closeTopModal(document)
              else if (sidebarTab !== undefined) ctx.sidebarRight.close(sidebarTab.id)
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
              <SettingsForm fields={page.fields} form={formFor(page.ns)} namespace={page.ns} t={t} />
            </section>
          ))}
        </div>
      )
    }
    ctx.effect(() => provideSettingsPageRenderer(PluginsPageSettings), 'settings-shell: Plugins page settings')

    const openRequest = (request: OpenSettingsRequest): void => {
      const requested = request.surface ?? surface()
      if (request.setting !== undefined && openSettingsTarget(request.setting, requested)) return
      if (requested === 'sidebar') {
        openSidePanelSettings(request.section)
        if (request.query !== undefined) actor.send({ type: 'search', query: request.query })
        return
      }
      actor.send(request.section === undefined ? { type: 'open', surface: requested } : { type: 'open', surface: requested, sectionId: request.section })
      if (request.query !== undefined) actor.send({ type: 'search', query: request.query })
    }

    const PanelHost = (): JSX.Element => {
      const [element, setElement] = useState<HTMLDivElement | null>(null)
      useEffect(() => {
        mainPanelHostSlot.set(element)
        return () => mainPanelHostSlot.set(null)
      }, [element])
      return <div className="dshx:h-full dshx:min-h-0 dshx:w-full" data-settings-panel-host="" ref={setElement} />
    }
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SETTINGS_PANEL_ID }, PanelHost))

    // Settings also lives in the side panel: its own guide card, beside Files, Jujutsu and the other panel cards.
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: SETTINGS_SIDEBAR_TAB_ID,
          kind: SETTINGS_SIDEBAR_KIND,
          title: () => t('title'),
          guide: [
            {
              id: 'settings',
              order: 90,
              title: () => t('title'),
              description: () => t('sidebar.guide'),
              commandId: openSettingsCommand,
              icon: (props: { readonly size?: number | undefined }) => <SettingsIcon aria-hidden size={props.size ?? 18} />,
            },
          ],
        }),
      'settings-shell: side panel tab type',
    )
    /** The side panel tab's body is a host: the shell entry, which owns the section slots, portals its page into it. */
    const SidePanelHost = (): JSX.Element => {
      const [element, setElement] = useState<HTMLDivElement | null>(null)
      useEffect(() => {
        sidePanelHostSlot.set(element)
        return () => sidePanelHostSlot.set(null)
      }, [element])
      return <div className="dshx:h-full dshx:min-h-0 dshx:w-full" data-settings-side-panel-host="" ref={setElement} />
    }
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: SETTINGS_SIDEBAR_TAB_ID }, SidePanelHost))

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
          PaletteApi.registerAction({
            id: '@dshfiles/settings-shell/open',
            label: () => t('palette.open'),
            aliases: ['settings', 'preferences', 'options'],
            group: 'command',
            run: () => openSettings(),
          }),
          PaletteApi.registerAction({
            id: '@dshfiles/settings-shell/open-side-panel',
            label: () => t('palette.sidePanel'),
            aliases: ['settings', 'preferences', 'side panel'],
            group: 'command',
            run: () => openSidePanelSettings(),
          }),
          ...[...sections.getSnapshot(), ...pluginPages.getSnapshot().map(page => ({ id: page.pageId, label: page.title }))].map(row =>
            PaletteApi.registerAction({
              id: `@dshfiles/settings-shell/section/${row.id}`,
              label: () => t('palette.section', { section: row.label }),
              aliases: ['settings', 'preferences'],
              group: 'command',
              run: () => openSettings(row.id),
            }),
          ),
        ]
      }
      const disposers = [sections.subscribe(register), pluginPages.subscribe(register)]
      register()
      // Plugin pages come from the settings mirror, which otherwise loads on the first Settings open.
      void describe.ensure()
      return () => {
        disposers.forEach(dispose => dispose())
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

    // The Desktop shell shows its own first-run flow, as natively; the browser gets the preview notice.
    if (!('dshDesktop' in globalThis)) {
      const welcome = new WelcomeNoticeStore(preferences)
      ctx.effect(() => () => welcome.dispose(), 'settings-shell: welcome notice')
      ctx.slots.inject('settings.onboarding', () =>
        ctx.slots.register(
          { name: 'settings.onboarding', id: WELCOME_STEP_ID, order: -100, priority: -1, locale: WELCOME_LOCALE_NAMESPACE },
          (props: { readonly complete: () => void; readonly t: WelcomeTranslate }) => (
            <WelcomeNotice complete={props.complete} controller={welcome} t={props.t} />
          ),
        ),
      )
    }

    // A page that reconnected to another Host release pauses plugin updates until the user reloads.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'host-release-change',
          locale: SHELL_LOCALE_NAMESPACE,
          inject: () => ({
            dismissRelease: (): void => ctx.modules.entries.dismissRelease(),
            reloadPage: (): void => globalThis.location.reload(),
            hooks: { releaseChange: ctx.modules.entries.releaseChange },
          }),
        },
        (props: {
          readonly t: ShellTranslate
          readonly useReleaseChange: SnapshotSelectorHook<ClientReleaseChange | undefined>
          readonly dismissRelease: () => void
          readonly reloadPage: () => void
        }) => <HostReleasePrompt {...props} />,
      ),
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
        openDefault: async path => (await ctx.remote.session.openWorkspacePath({ path })).ok,
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
