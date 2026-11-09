import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientReleaseChange } from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { resolveSlotLabel, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import {
  createApiClient,
  defineClient,
  provideSettingsPageRenderer,
  publishSettingsSearchEntries,
  SettingsWriteJournal,
  settingsSearchEntries,
  subscribeSettingsSearchEntries,
  useApiQuery,
  type SettingsPageRendererProps,
  type SettingsSectionSearchProps,
} from '@dshfiles/dshx/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { PaletteActions, type PaletteAction } from '@dshfiles/command-palette/palette-contract'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { ConfigForm, SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'

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
import { bundleLabelsOf, type BundleLabel } from './bundle-labels.js'
import { DshReleaseNotice } from './release-notice.js'
import { OPEN_SETTINGS_EVENT, openSettingsRequestSchema, type OpenSettingsRequest } from './open-settings.js'
import { PluginSettingsPageView } from './plugin-settings-page.js'
import type { SettingField } from './schema-form/schema-model.js'
import { SettingsForm } from './schema-form/settings-form.js'
import { SettingsPluginPages, type NamespaceLabel, type PluginSettingsPage } from './plugin-settings.js'
import { SettingsGroups, type GroupedEntries } from './settings-groups.js'
import { SettingsSearch, type SectionEntryRow, type ShortcutRow } from './settings-search.js'
import { SettingsTab, type SectionRow, type SettingsViewProps } from './settings-view.js'
import { shellMachine, type FieldTarget } from './shell-machine.js'
import { PORTED_FROM } from './upstream.js'
import { createSettingsWorkbenchHub, registerSettingsWorkbenchPanels, type SettingsOpenRequest, settingsWorkbenchPanelId } from './workbench-panels.js'

/** The main panel Settings fills when it opens as a tab; main-tabs names the tab "Settings" from this id. */
const SETTINGS_PANEL_ID = 'dshfiles-settings'
const SETTINGS_NAMESPACE = 'dshfiles-settings-shell'
const MAIN_TABS_OVERLAY_ID = 'dshfiles-main-tabs'
/** The Editor plugin's right-pane tab and its cross-plugin open request (`@dshfiles/editor` README). */
const EDITOR_PANE_ID = '@dshfiles/editor/files'
const PUBLISH_SETTLE_MS = 250
const OPEN_FILE_EVENT = 'dshfiles:open-file'
const OPEN_SETTINGS_COMMAND = 'settings.open'

/** A frame's portal target: the element the panel currently renders, or null while unmounted. */
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
const clientConnectionSchema = Schema.declare<ConnectionHandle>(
  (value): value is ConnectionHandle =>
    typeof value === 'object' &&
    value !== null &&
    'reconnect' in value &&
    typeof value.reconnect === 'function' &&
    'state' in value &&
    typeof value.state === 'object' &&
    value.state !== null &&
    'getSnapshot' in value.state &&
    typeof value.state.getSnapshot === 'function' &&
    'subscribe' in value.state &&
    typeof value.state.subscribe === 'function',
)

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
  inject: ['slots', 'connection', 'remote', 'remote.settings', 'remote.session', 'configForms', 'shortcuts', 'sessions', 'layout', 'modules'],
  setup(ctx, decorate, metadata) {
    const t = ctx.locale.bind(SHELL_LOCALE_NAMESPACE)
    const connection = Schema.decodeUnknownSync(clientConnectionSchema)(ctx.get('connection'))
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
    const inStage: ObservableSnapshot<boolean> = { getSnapshot: () => actor.getSnapshot().matches('tab'), subscribe: subscribeActor }
    /** The latest section or field asked for; the Settings pane keeps its own navigation, so it follows these too. */
    const openRequests = createSnapshotStore<SettingsOpenRequest | undefined>(undefined)

    // Settings follows the main view: a Settings tab picked in the strip, or a reload landing on it, opens it there.
    ctx.effect(() => {
      const report = (): void => actor.send({ type: ctx.layout.panelInfo.getSnapshot().activePanelId === SETTINGS_PANEL_ID ? 'panel.shown' : 'panel.hidden' })
      const dispose = ctx.layout.panelInfo.subscribe(report)
      report()
      return dispose
    }, 'settings-shell: follow the main view')

    const preferences = ctx.configForms.get<unknown>(SETTINGS_NAMESPACE)
    const journaledForms = new Map<string, ConfigForm<unknown>>()
    const formFor = (ns: string): ConfigForm<unknown> => {
      const existing = journaledForms.get(ns)
      if (existing !== undefined) return existing
      const form = ctx.configForms.get<unknown>(ns)
      const writes = SettingsWriteJournal.wrap(ns, form)
      const journaled: ConfigForm<unknown> = {
        getSnapshot: () => form.getSnapshot(),
        subscribe: listener => form.subscribe(listener),
        mutate: (ops, expectedRevision) => writes.mutate(ops, expectedRevision),
        set: (field, value) => writes.set(field, value),
        unset: field => writes.unset(field),
      }
      journaledForms.set(ns, journaled)
      return journaled
    }
    /**
     * Settings has one place: a page in the stage (plan `docs/ade-ux` §4.6). The gear, the rail, the palette, Mod+,
     * and other plugins' open requests all land there; the former dialog, expanded dialog and side-panel presentations
     * are gone, and a request that still names one opens the page.
     */
    const openSettings = (sectionId?: string): void => {
      actor.send(sectionId === undefined ? { type: 'open' } : { type: 'open', sectionId })
      openRequests.set(sectionId === undefined ? undefined : { sectionId })
    }
    /** Opens another plugin's page in the stage: Settings links AI accounts, MCP servers, Secrets and Hosts. */
    const openPanel = (panelId: string): void => {
      if (isMainPanelId(panelId)) ctx.layout.selectPanel(panelId)
    }

    // Bundle manifests title each namespace ("Thread Sidebar" for `thread-sidebar`). The workbench lists pages even
    // while Settings is closed, so resolve this one label snapshot when the provider becomes available.
    const labels = createSnapshotStore<ReadonlyMap<string, NamespaceLabel>>(new Map())
    const installLabels = (rows: readonly BundleLabel[]): void => {
      const next = new Map<string, NamespaceLabel>()
      for (const row of rows) {
        // A package name is no title; without manifest text the page falls back to the schema or the id.
        const resolvedTitle = row.title === undefined ? '' : ctx.locale.resolveText(row.title)
        next.set(row.rowId, {
          title: resolvedTitle === row.bundleName || resolvedTitle === row.moduleName ? '' : resolvedTitle,
          description: row.description === undefined ? (row.bundleDescription ?? '') : ctx.locale.resolveText(row.description),
        })
      }
      labels.set(next)
    }
    const labelsApi = createApiClient(ctx, settingsShellApi, metadata?.packageId)
    ctx.inject(['remote.pluginManager'], scoped => {
      // The Host caches these labels: core's listBundles reads every plugin's files on each call. A Host started before
      // that method existed is asked the old way.
      void labelsApi.safe.bundleLabels().then(async cached => {
        if (cached.ok) return installLabels(cached.value)
        const result = await scoped.remote.pluginManager.listBundles()
        if (result.ok) installLabels(bundleLabelsOf(result.value))
      })
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
      // The pages read only the active locale's text; keying on the revision rebuilt them for every namespace a plugin
      // registered during boot (~130 ms of the reload's main thread).
      () => `${String(describe.getSnapshot().view?.namespaces.length)}:${ctx.locale.getSnapshot().active}:${labelsVersion()}:${describeVersion()}`,
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

    /** The page that draws one settings field, as Settings groups it (a Jev field sits under Tools & MCP › Jev). */
    const fieldTargetFor = (target: { readonly entryId: string; readonly fieldPath: readonly string[] }): FieldTarget | undefined => {
      const entry = SettingsGroups.entryForField(groups.getSnapshot(), target.entryId, target.fieldPath)
      const key = target.fieldPath[0]
      const page = [...(entry?.pages ?? []), ...(entry?.hiddenPages ?? [])].find(
        candidate => candidate.ns === target.entryId && candidate.fields.some(field => field.path[0] === key),
      )
      if (page !== undefined) return { sectionId: page.pageId, fieldPath: target.fieldPath }
      // Not grouped yet (the settings mirror is still loading): the namespace's own page id still opens it later.
      return pluginPages.getSnapshot().some(candidate => candidate.ns === target.entryId)
        ? { sectionId: SettingsPluginPages.pluginPageId(target.entryId), fieldPath: target.fieldPath }
        : undefined
    }
    /** Opens the page that edits one settings field; false when no served namespace has it. */
    const openSettingsTarget = (target: { readonly entryId: string; readonly fieldPath: readonly string[] }): boolean => {
      void describe.ensure()
      const field = fieldTargetFor(target)
      if (field === undefined) return false
      actor.send({ type: 'open', field })
      openRequests.set({ sectionId: field.sectionId, field })
      return true
    }

    /** One element a Settings frame portals into (the main panel): null while it is unmounted. */
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

    const desktopUpdate = new DesktopUpdateSource(desktopUpdateBridge())
    ctx.effect(() => () => desktopUpdate.dispose(), 'settings-shell: desktop update carrier')

    const sections = ledgerProjection<readonly SectionRow[]>(
      () =>
        ctx.slots
          .entriesOfSlot('settings.section')
          .map(entry => ({
            id: entry.options.id ?? '',
            order: entry.options.order ?? 0,
            label: resolveSlotLabel(entry.options.label) ?? entry.options.id ?? '',
          }))
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
    // Every Settings entry by task group: sections, plugin pages and the stage pages Settings links (§4.6).
    const panelsVersion = (): string => String(ctx.slots.getVersion('main'))
    const groups = ledgerProjection<readonly GroupedEntries[]>(
      () =>
        SettingsGroups.group({
          sections: sections.getSnapshot(),
          pages: pluginPages.getSnapshot(),
          panels: new Set(ctx.slots.entriesOfSlot('main').flatMap(entry => entry.options.key ?? [])),
        }),
      () => `${ctx.slots.getVersion('settings.section')}:${ctx.locale.getSnapshot().revision}:${labelsVersion()}:${describeVersion()}:${panelsVersion()}`,
      listener => {
        const offSections = sections.subscribe(listener)
        const offPages = pluginPages.subscribe(listener)
        const offPanels = ctx.slots.subscribe('main', listener)
        return () => {
          offSections()
          offPages()
          offPanels()
        }
      },
    )
    // Search rows: sections under their entry's name and group, so "Models & accounts" or "AI accounts" find them.
    const searchRows = (grouped: readonly GroupedEntries[]): readonly SectionRow[] =>
      grouped.flatMap(({ group, entries }) =>
        entries.map(entry => ({ id: entry.id, order: entry.order, label: entry.label, keywords: `${group.label} ${entry.keywords}` })),
      )
    let shortcutSource: readonly ShortcutCatalogEntry[] | undefined
    let shortcutRows: readonly ShortcutRow[] = []
    const shortcutsFor = (catalog: readonly ShortcutCatalogEntry[]): readonly ShortcutRow[] => {
      if (catalog !== shortcutSource) {
        shortcutSource = catalog
        shortcutRows = catalog
          .filter(entry => entry.keys.length > 0)
          .map(entry => ({ id: entry.id, label: entry.label, aliases: entry.aliases, keys: entry.keys }))
      }
      return shortcutRows
    }

    const publishedVersion = identityVersion(() => settingsSearchEntries())
    const reportedInvalid = new Set<string>()
    const sectionEntries = ledgerProjection<readonly SectionEntryRow[]>(
      () =>
        SettingsSearch.entryRows({
          sections: sections.getSnapshot(),
          published: settingsSearchEntries(),
          onInvalid: failure => {
            if (reportedInvalid.has(failure.sectionId)) return
            reportedInvalid.add(failure.sectionId)
            console.warn(`settings-shell: ignored the search entries of settings section ${failure.sectionId}: ${failure.message}`)
          },
        }),
      () => `${ctx.slots.getVersion('settings.section')}:${ctx.locale.getSnapshot().revision}:${publishedVersion()}`,
      listener => {
        const offSections = sections.subscribe(listener)
        const offPublished = subscribeSettingsSearchEntries(listener)
        return () => {
          offSections()
          offPublished()
        }
      },
    )
    // The General rows are this plugin's own: the ledger never carries metadata for an imperative registration.
    ctx.effect(() => {
      let unpublish = (): void => {}
      const publish = (): void => {
        unpublish()
        unpublish = publishSettingsSearchEntries({
          sectionId: 'general',
          entries: [{ id: 'developer-tools', title: t('developerTools.title'), description: t('developerTools.description'), keywords: 'developer devtools' }],
        })
      }
      publish()
      const offLocale = ctx.locale.subscribe(publish)
      return () => {
        offLocale()
        unpublish()
      }
    }, 'dshfiles-settings-shell: General search entries')

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
    const sectionTarget: ObservableSnapshot<string | undefined> = { getSnapshot: () => actor.getSnapshot().context.target, subscribe: subscribeActor }
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

    /** Everything the Settings page shows, minus its frame and close button: the stage page and the docking hub share it. */
    const settingsViewProps = (input: {
      readonly renderSlot: ShellRenderSlot
      readonly t: ShellTranslate
      readonly groups: readonly GroupedEntries[]
      readonly activeId: string | undefined
      readonly field: FieldTarget | undefined
      readonly entries: readonly SectionEntryRow[]
      readonly target: string | undefined
      readonly query: string
      readonly shortcuts: readonly ShortcutRow[]
    }): Omit<SettingsViewProps, 'onClose'> => ({
      groups: input.groups,
      rows: searchRows(input.groups),
      activeId: input.activeId,
      sectionEntries: input.entries,
      sectionTarget: input.target,
      shortcuts: input.shortcuts,
      renderSlot: input.renderSlot,
      pluginPages: SettingsGroups.searchablePages(input.groups),
      renderPluginPage: (page: PluginSettingsPage, nested: boolean) => (
        <PluginSettingsPageView
          form={formFor(page.ns)}
          key={page.pageId}
          nested={nested}
          page={page}
          t={input.t}
          {...(input.field?.sectionId === page.pageId ? { focusPath: input.field.fieldPath } : {})}
        />
      ),
      renderMatches: (page: PluginSettingsPage, fields: readonly SettingField[], highlight: string) => (
        <SettingsForm fields={fields} form={formFor(page.ns)} highlight={highlight} key={page.pageId} namespace={page.ns} t={input.t} />
      ),
      sectionOwner,
      t: input.t,
      onSelect: (sectionId: string) => actor.send({ type: 'select', sectionId }),
      onReveal: entry => actor.send({ type: 'reveal', sectionId: entry.sectionId, target: entry.target }),
      onSearch: (next: string) => actor.send({ type: 'search', query: next }),
      openPanel,
      query: input.query,
    })

    const Surface = (props: { readonly renderSlot: ShellRenderSlot; readonly t: ShellTranslate }): JSX.Element | null => {
      const grouped = useObservable(groups)
      const activeId = useObservable(activeSection)
      const open = useObservable(inStage)
      const host = useObservable(mainPanelHostSlot.observable)
      const field = useObservable(fieldTarget)
      const query = useObservable(searchQuery)
      const entries = useObservable(sectionEntries)
      const target = useObservable(sectionTarget)
      const catalog = useObservable(ctx.shortcuts.catalog)
      useEffect(() => {
        void describe.ensure()
      }, [])
      const tabsLoaded = useObservable(mainTabsLoaded)
      if (!open || host === null) return null
      const view = settingsViewProps({
        renderSlot: props.renderSlot,
        t: props.t,
        groups: grouped,
        activeId,
        field,
        entries,
        target,
        query,
        shortcuts: shortcutsFor(catalog),
      })
      // With main-tabs the strip closes the tab; without it the header keeps a way back to the previous view.
      return <SettingsTab {...view} host={host} onClose={tabsLoaded ? undefined : deps.closeSettings} />
    }

    // The sidebar.settings entry remains the only settings.section declarer. Panels borrow its renderer; they never
    // register another settings slot or copy a native section implementation. The source exists even while closed.
    const WorkbenchSources = (props: { readonly renderSlot: ShellRenderSlot }): null => {
      const renderSlot = useRef(props.renderSlot)
      renderSlot.current = props.renderSlot
      useEffect(() => {
        const registry = workbenchPanels()
        const openSource = (id: string): void => {
          if (pluginPages.getSnapshot().some(page => page.pageId === id)) registry.open(settingsWorkbenchPanelId('page', id))
          else if (sections.getSnapshot().some(row => row.id === id)) registry.open(settingsWorkbenchPanelId('section', id))
          else openSettings(id)
        }
        return registerSettingsWorkbenchPanels(registry, {
          hub: {
            title: t('title'),
            component: createSettingsWorkbenchHub({
              groups,
              openRequests,
              closeSettings: deps.closeSettings,
              view: input =>
                settingsViewProps({
                  ...input,
                  entries: sectionEntries.getSnapshot(),
                  target: sectionTarget.getSnapshot(),
                  shortcuts: shortcutsFor(ctx.shortcuts.catalog.getSnapshot()),
                  renderSlot: (...args) => renderSlot.current(...args),
                  t,
                }),
            }),
          },
          sections,
          pages: pluginPages,
          renderSlot: (...args) => renderSlot.current(...args),
          renderPage: page => <WorkbenchPluginPage page={page} />,
          owner: close => ({
            ...sectionOwner,
            close,
            openSection: openSource,
            openSettingsTarget: (target: { readonly entryId: string; readonly fieldPath: readonly string[] }) => {
              const field = fieldTargetFor(target)
              if (field === undefined) return false
              actor.send({ type: 'focus', field })
              registry.open(settingsWorkbenchPanelId('page', SettingsPluginPages.pluginPageId(target.entryId)))
              return true
            },
          }),
          title: label => t('palette.section', { section: label }),
          closeSettings: deps.closeSettings,
          decorate,
        })
      }, [])
      return null
    }
    const WorkbenchPluginPage = (props: { readonly page: PluginSettingsPage }): JSX.Element => {
      const field = useObservable(fieldTarget)
      return (
        <PluginQueryProvider>
          <PluginSettingsPageView
            form={formFor(props.page.ns)}
            page={props.page}
            t={t}
            {...(field?.sectionId === props.page.pageId ? { focusPath: field.fieldPath } : {})}
          />
        </PluginQueryProvider>
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
        modals: [],
        resolve: ({ modal }) => {
          if (modal !== null) return { status: 'blocked', reason: 'modal' }
          return {
            status: 'handled',
            // Mod+, toggles the Settings page in the stage.
            run: () => (actor.getSnapshot().matches('tab') ? deps.closeSettings() : deps.openSettings()),
          }
        },
      })
      const disposeSlot = ctx.slots.register(
        { name: 'sidebar.settings', locale: SHELL_LOCALE_NAMESPACE, children: SHELL_CHILDREN },
        decorate((props: { readonly wide: boolean; readonly t: ShellTranslate; readonly renderSlot: ShellRenderSlot }) => (
          <>
            <WorkbenchSources renderSlot={props.renderSlot} />
            <ShellRoot
              deps={deps}
              renderSlot={props.renderSlot}
              surface={<Surface renderSlot={props.renderSlot} t={props.t} />}
              t={props.t}
              wide={props.wide}
            />
          </>
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
    ctx.effect(() => provideSettingsPageRenderer(PluginsPageSettings), 'dshfiles-settings-shell: Plugins page settings')

    // A request that still names the retired dialog surface opens the page: there is no other place left.
    const openRequest = (request: OpenSettingsRequest): void => {
      if (request.setting !== undefined && openSettingsTarget(request.setting)) return
      const openEvent: { type: 'open'; sectionId?: string; target?: string } = { type: 'open' }
      if (request.section !== undefined) openEvent.sectionId = request.section
      if (request.target !== undefined) openEvent.target = request.target
      actor.send(openEvent)
      openRequests.set(request.section === undefined ? undefined : { sectionId: request.section })
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

    ctx.effect(() => {
      const onOpenSettings = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const request = Schema.decodeUnknownOption(openSettingsRequestSchema)(event.detail ?? {})
        if (Option.isNone(request)) return
        event.preventDefault()
        openRequest(request.value)
      }
      window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
      return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
    }, 'settings-shell: open-settings requests')

    const addPaletteAction = (action: PaletteAction): (() => void) => metadata?.plugin?.add(PaletteActions, action) ?? (() => {})
    ctx.effect(() => {
      let registered: Array<() => void> = []
      const register = (): void => {
        registered.forEach(dispose => dispose())
        registered = [
          addPaletteAction({
            id: '@dshfiles/settings-shell/open',
            label: () => t('palette.open'),
            aliases: ['settings', 'preferences', 'options'],
            group: 'command',
            run: () => openSettings(),
          }),
          // One row per Settings entry, named by the entry and its group, never by the package behind it.
          ...groups.getSnapshot().flatMap(({ group, entries }) =>
            entries.map(entry =>
              addPaletteAction({
                id: `@dshfiles/settings-shell/section/${entry.id}`,
                label: () => t('palette.section', { section: entry.label }),
                aliases: ['settings', 'preferences', group.label, ...entry.keywords.split(' ')],
                group: 'command',
                run: () => openSettings(entry.id),
              }),
            ),
          ),
        ]
      }
      const disposers = [groups.subscribe(register)]
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
      ctx.slots.register(
        { name: 'settings.trigger', locale: SHELL_LOCALE_NAMESPACE },
        decorate((props: { readonly wide: boolean; readonly t: ShellTranslate }) => (
          <PluginQueryProvider>
            <TriggerContent t={props.t} wide={props.wide} />
          </PluginQueryProvider>
        )),
      ),
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

    const api = createApiClient(ctx, settingsShellApi, metadata?.packageId)
    // `settings_list` searches the same section entries for an Agent; a Host without the method just refuses it.
    ctx.effect(() => {
      let published: string | undefined
      let pending: ReturnType<typeof setTimeout> | undefined
      // Every section that registers changes the list, so boot would send one request per section; send the settled set.
      // A locale revision rebuilds an equal list, so compare contents: identity sent six equal sets per page load.
      const publish = (): void => {
        if (pending !== undefined) clearTimeout(pending)
        pending = setTimeout(() => {
          pending = undefined
          const entries = sectionEntries.getSnapshot()
          const serialized = JSON.stringify(entries)
          if (serialized === published) return
          published = serialized
          void api.safe.publishSearchEntries({ entries: [...entries] })
        }, PUBLISH_SETTLE_MS)
      }
      // A reconnect may reach a restarted Host that lost the last set.
      const republish = (): void => {
        published = undefined
        publish()
      }
      publish()
      const offEntries = sectionEntries.subscribe(publish)
      const offConnection = connection.state.subscribe(republish)
      return () => {
        if (pending !== undefined) clearTimeout(pending)
        offEntries()
        offConnection()
      }
    }, 'settings-shell: section entries for the Agent')

    // Native policy: only a loopback page gets the privileged document actions (and the path they reveal).
    if (ctx.remote.$host.isLoopback) {
      const documentController = new SettingsDocumentStore(ctx.configForms.describe(), () => ctx.remote.settings.openSettingsDocument())
      ctx.effect(() => () => documentController.dispose(), 'settings-shell: document action')
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
          return !window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: { path }, cancelable: true }))
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
        (props: PropsRenderSlots<'settings.general.item'> & SettingsSectionSearchProps) => (
          <GeneralSection renderSlot={props.renderSlot} target={props.target} />
        ),
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
        { name: 'settings.general.item', id: 'dsh-release-notice', order: 10, locale: SHELL_LOCALE_NAMESPACE },
        decorate((props: { readonly t: ShellTranslate }) => (
          <PluginQueryProvider>
            <DshReleaseNotice t={props.t} />
          </PluginQueryProvider>
        )),
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
