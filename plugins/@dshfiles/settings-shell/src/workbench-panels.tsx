import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkbenchPanelDefinition, WorkbenchPanelProps, WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { useState, type ReactNode } from 'react'
import type { ShellRenderSlot } from './native/slots.js'
import { useObservable } from './native/use-observable.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { SettingsTab, type SectionRow, type SettingsViewProps } from './settings-view.js'
import type { FieldTarget } from './shell-machine.js'

export const SETTINGS_WORKBENCH_HUB_ID = 'dshfiles-settings'

interface SettingsWorkbenchHubInput {
  readonly rows: readonly SectionRow[]
  readonly pluginPages: readonly PluginSettingsPage[]
  readonly activeId: string | undefined
  readonly field: FieldTarget | undefined
  readonly query: string
}

/** The existing Settings navigator, with navigation/search owned by this pane rather than the modal actor. */
export const createSettingsWorkbenchHub = (sources: {
  readonly sections: ObservableSnapshot<readonly SectionRow[]>
  readonly pages: ObservableSnapshot<readonly PluginSettingsPage[]>
  readonly view: (input: SettingsWorkbenchHubInput) => Omit<SettingsViewProps, 'variant' | 'onClose'>
  readonly closeSettings: () => void
}): WorkbenchPanelDefinition['component'] =>
  function SettingsWorkbenchHub(props) {
    const rows = useObservable(sources.sections)
    const pluginPages = useObservable(sources.pages)
    const [activeId, setActiveId] = useState<string>()
    const [field, setField] = useState<FieldTarget>()
    const [query, setQuery] = useState('')
    const [host, setHost] = useState<HTMLDivElement | null>(null)
    const select = (id: string): void => {
      setActiveId(id)
      setField(undefined)
      setQuery('')
    }
    const close = props.onClose ?? sources.closeSettings
    const view = sources.view({ rows, pluginPages, activeId, field, query })
    const owner: SettingsSectionOwnerProps & {
      readonly openSection: (sectionId: string) => void
      readonly openSettingsTarget: (target: { readonly entryId: string; readonly fieldPath: readonly string[] }) => boolean
    } = {
      ...view.sectionOwner,
      close,
      openSection: select,
      openSettingsTarget: target => {
        const page = pluginPages.find(candidate => candidate.ns === target.entryId)
        if (page === undefined) return false
        select(page.pageId)
        setField({ sectionId: page.pageId, fieldPath: target.fieldPath })
        return true
      },
    }
    return (
      <div className="dshx-root dshx:h-full dshx:min-h-0 dshx:w-full" data-settings-workbench-hub="" ref={setHost}>
        {host !== null && (
          <SettingsTab
            {...view}
            host={host}
            variant="tab"
            sectionOwner={owner}
            onClose={close}
            onSelect={select}
            onSearch={setQuery}
            onBack={() => {
              setActiveId(undefined)
              setQuery('')
            }}
          />
        )}
      </div>
    )
  }

/** The namespace and kind keep a native section distinct from a schema-generated page with the same id. */
export const settingsWorkbenchPanelId = (kind: 'section' | 'page', id: string): string =>
  `dshfiles-settings.${kind}/${Array.from(new TextEncoder().encode(id), byte => byte.toString(16).padStart(2, '0')).join('')}`

interface SettingsWorkbenchSources {
  readonly hub: { readonly title: string; readonly component: WorkbenchPanelDefinition['component'] }
  readonly sections: ObservableSnapshot<readonly SectionRow[]>
  readonly pages: ObservableSnapshot<readonly PluginSettingsPage[]>
  /** Only the sidebar.settings declaring entry may supply this function. Never re-declare its slots. */
  readonly renderSlot: ShellRenderSlot
  readonly renderPage: (page: PluginSettingsPage) => ReactNode
  readonly owner: (close: () => void) => SettingsSectionOwnerProps
  readonly title: (label: string) => string
  readonly closeSettings: () => void
  readonly decorate: (component: WorkbenchPanelDefinition['component']) => WorkbenchPanelDefinition['component']
}

/**
 * Project the existing settings sources into the public panel registry. Component identities survive label/locale
 * refreshes, so an open form is not remounted. Disposal follows the declaring entry, not the workbench's mount.
 */
export const registerSettingsWorkbenchPanels = (registry: Pick<WorkbenchPanelRegistry, 'register'>, sources: SettingsWorkbenchSources): (() => void) => {
  const registrations = new Map<string, { readonly definition: WorkbenchPanelDefinition; readonly dispose: () => void }>()
  const disposeHub = registry.register({
    id: SETTINGS_WORKBENCH_HUB_ID,
    mainPanelId: SETTINGS_WORKBENCH_HUB_ID,
    title: sources.hub.title,
    component: sources.decorate(sources.hub.component),
    allowMultiple: true,
  })

  const componentFor = (kind: 'section' | 'page', sourceId: string): WorkbenchPanelDefinition['component'] =>
    function SettingsWorkbenchPanel(props: WorkbenchPanelProps) {
      const rows = useObservable(sources.sections)
      const pages = useObservable(sources.pages)
      const row = kind === 'section' ? rows.find(candidate => candidate.id === sourceId) : undefined
      const page = kind === 'page' ? pages.find(candidate => candidate.pageId === sourceId) : undefined
      // A removed registration's already-open panel must never fall through to another settings section.
      if (row === undefined && page === undefined) return null
      return (
        <section
          aria-label={sources.title(row?.label || page?.title || sourceId)}
          className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto dshx:p-4"
          data-settings-workbench-source={sourceId}
        >
          {page === undefined
            ? sources.renderSlot('settings.section', sources.owner(props.onClose ?? sources.closeSettings), { only: sourceId })
            : sources.renderPage(page)}
        </section>
      )
    }

  const sync = (): void => {
    const desired = new Map<string, { readonly kind: 'section' | 'page'; readonly sourceId: string; readonly title: string }>()
    for (const row of sources.sections.getSnapshot()) {
      if (row.id === '') continue
      desired.set(settingsWorkbenchPanelId('section', row.id), { kind: 'section', sourceId: row.id, title: sources.title(row.label || row.id) })
    }
    for (const page of sources.pages.getSnapshot()) {
      if (page.pageId === '') continue
      desired.set(settingsWorkbenchPanelId('page', page.pageId), { kind: 'page', sourceId: page.pageId, title: sources.title(page.title || page.pageId) })
    }
    for (const [id, current] of registrations) {
      if (desired.has(id)) continue
      current.dispose()
      registrations.delete(id)
    }
    for (const [id, source] of desired) {
      const current = registrations.get(id)
      if (current?.definition.title === source.title) continue
      const definition: WorkbenchPanelDefinition = {
        id,
        title: source.title,
        component: current?.definition.component ?? sources.decorate(componentFor(source.kind, source.sourceId)),
        // Retain saved/programmatic targets without flooding the New tab chooser.
        hiddenFromAdd: true,
      }
      // Register the replacement first: its identity-aware predecessor disposer cannot remove the newer definition.
      const dispose = registry.register(definition)
      current?.dispose()
      registrations.set(id, { definition, dispose })
    }
  }

  const unsubscribe = [sources.sections.subscribe(sync), sources.pages.subscribe(sync)]
  sync()
  return () => {
    disposeHub()
    unsubscribe.forEach(dispose => dispose())
    registrations.forEach(registration => registration.dispose())
    registrations.clear()
  }
}
