import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ShellRenderSlot } from './native/slots.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import type { SectionRow } from './settings-view.js'
import { createSettingsWorkbenchHub, registerSettingsWorkbenchPanels, SETTINGS_WORKBENCH_HUB_ID, settingsWorkbenchPanelId } from './workbench-panels.js'
import type { ShellTranslate } from './native/locales.js'

// The shared Node primitive double omits the native Settings navigation glyphs.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...(await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()),
  IconSettingsOutlineMedium: () => <svg aria-hidden />,
}))

const page: PluginSettingsPage = { pageId: 'plugin:example', ns: 'example', title: 'Example', description: '', group: 'plugins', fields: [] }

/** Real identity-aware registry contract, bounded to the bridge's one dependency. */
const registryFixture = () => {
  const definitions = new Map<string, WorkbenchPanelDefinition>()
  const register = vi.fn<WorkbenchPanelRegistry['register']>(definition => {
    definitions.set(definition.id, definition)
    return () => {
      if (definitions.get(definition.id) === definition) definitions.delete(definition.id)
    }
  })
  return { register, definitions }
}

const fixture = () => {
  const registry = registryFixture()
  const sections = createSnapshotStore<readonly SectionRow[]>([{ id: 'general', label: 'General', order: 0 }])
  const pages = createSnapshotStore<readonly PluginSettingsPage[]>([page])
  const renderSlot: ShellRenderSlot = () => <span>Authorized section</span>
  const closeSettings = vi.fn()
  const dispose = registerSettingsWorkbenchPanels(registry, {
    hub: { title: 'Settings', component: () => <span>Settings navigator</span> },
    sections,
    pages,
    renderSlot,
    renderPage: current => <span>{current.description || current.title}</span>,
    owner: close => ({ close }),
    title: label => `Settings: ${label}`,
    closeSettings,
    decorate: component => component,
  })
  return { ...registry, sections, pages, dispose, closeSettings }
}

const definition = (definitions: ReadonlyMap<string, WorkbenchPanelDefinition>, kind: 'section' | 'page', id: string): WorkbenchPanelDefinition => {
  const value = definitions.get(settingsWorkbenchPanelId(kind, id))
  if (value === undefined) throw new Error(`Missing ${kind} ${id}`)
  return value
}

describe('Settings workbench sources', () => {
  it('keeps navigation inside each hub and renders the original section and plugin-page controls', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const sections = createSnapshotStore<readonly SectionRow[]>([{ id: 'general', label: 'General', order: 0 }])
    const pages = createSnapshotStore<readonly PluginSettingsPage[]>([page])
    const modalNavigation = vi.fn()
    const close = vi.fn()
    const fields: unknown[] = []
    const t: ShellTranslate = key => key
    const Hub = createSettingsWorkbenchHub({
      sections,
      pages,
      closeSettings: close,
      view: input => {
        fields.push(input.field)
        return {
          ...input,
          sectionEntries: [],
          sectionTarget: undefined,
          onReveal: vi.fn(),
          renderSlot: name => {
            if (name !== 'settings.section') return null
            return <input aria-label="Original General control" defaultValue="original value" />
          },
          renderPluginPage: current => <input aria-label="Original plugin control" defaultValue={current.title} />,
          renderMatches: () => null,
          sectionOwner: { close: modalNavigation },
          t,
          onSelect: modalNavigation,
          onSearch: modalNavigation,
          onBack: modalNavigation,
          onExpand: modalNavigation,
          onRestore: modalNavigation,
          onMoveToTab: modalNavigation,
        }
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <>
            <Hub panelId="settings-one" />
            <Hub panelId="settings-two" />
          </>,
        ),
      )
      const hubs = host.querySelectorAll('[data-settings-workbench-hub]')
      const first = hubs.item(0)
      const second = hubs.item(1)
      expect(first.querySelector('input[aria-label="Original General control"]')).not.toBeNull()
      const example = first.querySelector<HTMLButtonElement>('button[data-nav-id="plugin:example"]')
      await act(async () => example?.click())
      expect(first.querySelector<HTMLInputElement>('input[aria-label="Original plugin control"]')?.value).toBe('Example')
      expect(second.querySelector('input[aria-label="Original General control"]')).not.toBeNull()
      const general = first.querySelector<HTMLButtonElement>('button[data-nav-id="general"]')
      await act(async () => general?.click())
      expect(first.querySelector('input[aria-label="Original General control"]')).not.toBeNull()
      expect(modalNavigation).not.toHaveBeenCalled()
      expect(host.querySelector('[role="dialog"]')).toBeNull()
      expect(host.querySelectorAll('[data-settings-view="tab"]')).toHaveLength(2)
      expect(fields.every(field => field === undefined)).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('offers one Settings hub and keeps individual sections/pages registered but hidden from the chooser', () => {
    const state = fixture()
    try {
      const panels = [...state.definitions.values()]
      expect(panels.map(value => value.title)).toEqual(['Settings', 'Settings: General', 'Settings: Example'])
      expect(panels.filter(value => !value.hiddenFromAdd).map(value => value.id)).toEqual([SETTINGS_WORKBENCH_HUB_ID])
      expect(state.definitions.get(SETTINGS_WORKBENCH_HUB_ID)?.mainPanelId).toBe(SETTINGS_WORKBENCH_HUB_ID)
      expect(panels.filter(value => value.hiddenFromAdd).every(value => value.mainPanelId === undefined)).toBe(true)
      state.sections.set([
        { id: 'general', label: 'General', order: 0 },
        { id: 'general', label: 'Winner', order: 1 },
      ])
      expect(state.definitions.size).toBe(3)
    } finally {
      state.dispose()
    }
    expect(state.definitions.size).toBe(0)
  })

  it('keeps a component mounted through label changes and removes disappeared sources and subscriptions', () => {
    const state = fixture()
    const initial = definition(state.definitions, 'section', 'general')
    state.sections.set([{ id: 'general', label: 'Général', order: 0 }])
    const translated = definition(state.definitions, 'section', 'general')
    expect(translated.title).toBe('Settings: Général')
    expect(translated.component).toBe(initial.component)
    expect(state.register).toHaveBeenCalledTimes(4)
    state.pages.set([])
    expect(state.definitions.size).toBe(2)
    state.dispose()
    state.sections.set([{ id: 'later', label: 'Later', order: 0 }])
    expect(state.definitions.size).toBe(0)
    expect(state.register).toHaveBeenCalledTimes(4)
  })

  it('encodes arbitrary source ids collision-free and keeps section and page identities distinct', () => {
    const inputs = ['models', 'plugin:models', 'plugin/models', '_3A', ':', '语言', 'a b', '%', "!()'*"]
    const ids = inputs.flatMap(id => [settingsWorkbenchPanelId('section', id), settingsWorkbenchPanelId('page', id)])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u)
    expect(settingsWorkbenchPanelId('section', 'general')).toBe('dshfiles-settings.section/67656e6572616c')
  })

  it('calls the declaring renderer with only the requested section and closes that panel occurrence', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const sections = createSnapshotStore<readonly SectionRow[]>([{ id: 'general', label: 'General', order: 0 }])
    const pages = createSnapshotStore<readonly PluginSettingsPage[]>([])
    const registry = registryFixture()
    const calls: unknown[][] = []
    let owner: SettingsSectionOwnerProps | undefined
    const renderSlot: ShellRenderSlot = (...args) => {
      calls.push(args)
      return <span>Original General controls</span>
    }
    const closePanel = vi.fn()
    const closeSettings = vi.fn()
    const dispose = registerSettingsWorkbenchPanels(registry, {
      hub: { title: 'Settings', component: () => null },
      sections,
      pages,
      renderSlot,
      renderPage: () => null,
      owner: close => {
        owner = { close }
        return owner
      },
      title: label => `Settings: ${label}`,
      closeSettings,
      decorate: component => component,
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      const panel = definition(registry.definitions, 'section', 'general')
      const Panel = panel.component
      await act(async () => root.render(<Panel onClose={closePanel} panelId={panel.id} />))
      expect(host.textContent).toBe('Original General controls')
      expect(calls).toEqual([['settings.section', owner, { only: 'general' }]])
      owner?.close()
      expect(closePanel).toHaveBeenCalledOnce()
      expect(closeSettings).not.toHaveBeenCalled()
      // Source removal cannot silently render another settings section into the saved panel.
      await act(async () => sections.set([]))
      expect(host.textContent).toBe('')
      expect(calls).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      dispose()
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('reads updated plugin page content without remounting its registered component', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const state = fixture()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      const original = definition(state.definitions, 'page', page.pageId)
      const Panel = original.component
      await act(async () => root.render(<Panel panelId={original.id} />))
      expect(host.textContent).toBe('Example')
      await act(async () => state.pages.set([{ ...page, title: 'Exemple', description: 'Updated controls' }]))
      expect(host.textContent).toBe('Updated controls')
      expect(definition(state.definitions, 'page', page.pageId).component).toBe(Panel)
    } finally {
      await act(async () => root.unmount())
      state.dispose()
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})
