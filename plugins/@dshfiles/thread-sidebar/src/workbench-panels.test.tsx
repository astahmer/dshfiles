// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelMetadata } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { resolveSlotLabel, SlotCore, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createWorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSidebarWorkbenchPanels } from './workbench-panels.js'
import type { sidebarChildren } from './sidebar-contract.js'

afterEach(cleanup)

type FooterSources = Pick<Parameters<typeof registerSidebarWorkbenchPanels>[1], 'footerTitles' | 'subscribeFooterTitles'>

const setup = (footerSources?: FooterSources) => {
  const registry = createWorkbenchPanelRegistry()
  const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
  const panelInfo = createSnapshotStore<PanelInfo>({ activePanelId: null })
  const calls = vi.fn()
  const renderSlot: PropsRenderSlots<keyof typeof sidebarChildren>['renderSlot'] = (slot, owner, options) => {
    calls(slot, owner, options)
    return slot === 'sidebar.workspaces' ? (
      <section aria-label="Threads">{slot}</section>
    ) : (
      <span aria-hidden={slot === 'sidebar.panellist' ? true : undefined}>{slot}</span>
    )
  }
  const selectPanel = vi.fn()
  const expandSidebar = vi.fn()
  const decorate = vi.fn((component: Parameters<Parameters<typeof registerSidebarWorkbenchPanels>[1]['decorate']>[0]) => component)
  const startSession = vi.fn()
  const searchThreads = vi.fn()
  const customizeSidebar = vi.fn()
  const releaseCustomizationHost = vi.fn()
  const registerCustomizationHost = vi.fn((_host: HTMLElement) => releaseCustomizationHost)
  const footerLabels = createSnapshotStore<Readonly<Record<Parameters<FooterSources['footerTitles']>[0], readonly string[]>>>({
    'sidebar.footer.above': [],
    'sidebar.footer.action': [],
  })
  const dispose = registerSidebarWorkbenchPanels(registry, {
    renderSlot,
    footerTitles: footerSources?.footerTitles ?? (slot => footerLabels.getSnapshot()[slot]),
    subscribeFooterTitles: footerSources?.subscribeFooterTitles ?? footerLabels.subscribe,
    panels,
    panelInfo,
    selectPanel,
    expandSidebar,
    decorate,
    startSession,
    searchThreads,
    newThreadLabel: 'New thread',
    searchThreadsLabel: 'Search threads',
    customizeSidebar,
    registerCustomizationHost,
    sidebarSettingsLabel: 'Sidebar settings',
  })
  return {
    registry,
    panels,
    calls,
    selectPanel,
    expandSidebar,
    decorate,
    dispose,
    startSession,
    searchThreads,
    footerLabels,
    customizeSidebar,
    registerCustomizationHost,
    releaseCustomizationHost,
  }
}

describe('sidebar workbench panels', () => {
  it('keeps preview vertical padding compact without changing other panel insets', () => {
    const source = setup()
    for (const definition of source.registry.list()) {
      const Panel = definition.component
      const view = render(<Panel panelId={definition.id} />)
      const section = view.container.querySelector('[data-sidebar-workbench-source]')
      if (section === null) throw new Error('Sidebar panel content missing')
      if (definition.id === 'dshfiles-thread-sidebar.workbench-status') {
        expect(section.classList.contains('dshx:py-1')).toBe(true)
        expect(section.classList.contains('dshx:px-3')).toBe(true)
        expect(section.classList.contains('dshx:p-3')).toBe(false)
      } else {
        expect(section.classList.contains('dshx:p-3')).toBe(true)
      }
      view.unmount()
    }
    source.dispose()
  })
  it('registers the four real sidebar assemblies and disposes exactly its own entries', () => {
    const source = setup()
    expect(source.registry.list().map(panel => panel.title)).toEqual([
      'Thread Sidebar: Threads',
      'Thread Sidebar: Plugin previews',
      'Thread Sidebar: Plugin controls',
      'Thread Sidebar: Navigation',
    ])
    expect(source.decorate).toHaveBeenCalledTimes(4)
    source.registry.register({ id: 'unrelated', title: 'Unrelated', component: () => null })
    source.dispose()
    expect(source.registry.list().map(panel => panel.id)).toEqual(['unrelated'])
  })

  it('delegates the workspaces slot with genuine wide and expansion owner props', () => {
    const source = setup()
    const definition = source.registry.list().find(panel => panel.title === 'Thread Sidebar: Threads')
    if (definition === undefined) throw new Error('Threads source missing')
    const Panel = definition.component
    render(<Panel panelId={definition.id} />)
    expect(screen.getByText('sidebar.workspaces')).toBeTruthy()
    expect(screen.getAllByRole('region', { name: 'Threads' })).toHaveLength(1)
    expect(source.calls).toHaveBeenCalledWith('sidebar.workspaces', { wide: true, expandSidebar: source.expandSidebar }, undefined)
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search threads' }))
    expect(source.startSession).toHaveBeenCalledTimes(1)
    expect(source.searchThreads).toHaveBeenCalledTimes(1)
    source.dispose()
  })

  it('keeps the settings gear and its editor seat inside the Threads body, independent of tab chrome', () => {
    const source = setup()
    const definition = source.registry.get('dshfiles-thread-sidebar.workbench-threads')
    if (definition === undefined) throw new Error('Threads source missing')
    const Panel = definition.component
    const view = render(<Panel panelId={definition.id} visible />)
    const gear = screen.getByRole('button', { name: 'Sidebar settings' })
    expect(gear.querySelector('svg.lucide-settings')).toBeTruthy()
    expect(gear.hasAttribute('title')).toBe(false)
    expect(gear.closest('[data-sidebar-workbench-source]')?.getAttribute('data-sidebar-workbench-source')).toBe(definition.id)
    fireEvent.click(gear)
    expect(source.customizeSidebar).toHaveBeenCalledTimes(1)
    expect(source.registerCustomizationHost).toHaveBeenCalledTimes(1)
    const host = source.registerCustomizationHost.mock.calls[0]?.[0]
    expect(host?.contains(gear)).toBe(true)
    expect(host?.classList.contains('dshx:relative')).toBe(true)
    expect(host?.contains(screen.getByRole('region', { name: 'Threads' }))).toBe(true)
    view.unmount()
    expect(source.releaseCustomizationHost).toHaveBeenCalledTimes(1)
    source.dispose()
  })

  it('withdraws a hidden or unmounted Threads seat and registers the current seat when shown again', () => {
    const source = setup()
    const definition = source.registry.get('dshfiles-thread-sidebar.workbench-threads')
    if (definition === undefined) throw new Error('Threads source missing')
    const Panel = definition.component
    const view = render(<Panel panelId={definition.id} visible />)
    expect(source.registerCustomizationHost).toHaveBeenCalledTimes(1)
    view.rerender(<Panel panelId={definition.id} visible={false} />)
    expect(source.releaseCustomizationHost).toHaveBeenCalledTimes(1)
    view.rerender(<Panel panelId={definition.id} visible />)
    expect(source.registerCustomizationHost).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(source.releaseCustomizationHost).toHaveBeenCalledTimes(2)
    const moved = render(<Panel panelId={definition.id} visible />)
    expect(source.registerCustomizationHost).toHaveBeenCalledTimes(3)
    expect(source.registerCustomizationHost.mock.calls[2]?.[0]).not.toBe(source.registerCustomizationHost.mock.calls[0]?.[0])
    moved.unmount()
    expect(source.releaseCustomizationHost).toHaveBeenCalledTimes(3)
    source.dispose()
  })

  it('retains footer contributions as the actual declared slots with their real owner shares', () => {
    const source = setup()
    for (const title of ['Thread Sidebar: Plugin previews', 'Thread Sidebar: Plugin controls']) {
      const definition = source.registry.list().find(panel => panel.title === title)
      if (definition === undefined) throw new Error('Footer source missing')
      const Panel = definition.component
      const view = render(<Panel panelId={definition.id} />)
      view.unmount()
    }
    expect(source.calls).toHaveBeenCalledWith('sidebar.footer.above', {}, undefined)
    expect(source.calls).toHaveBeenCalledWith('sidebar.footer.action', { wide: true }, undefined)
    source.dispose()
  })

  it('reads live producer list labels and follows locale changes without replacing components or saved ids', async () => {
    const slots = new SlotCore()
    const releaseRoot = slots.register(
      { name: 'root', children: { 'sidebar.footer.above': { kind: 'list', scope: 'root' }, 'sidebar.footer.action': { kind: 'list', scope: 'root' } } },
      ({ renderSlot }) => renderSlot('sidebar.footer.above', {}),
    )
    let previewLabel = 'AI Accounts: Preview'
    const releasePreview = slots.register({ name: 'sidebar.footer.above', id: 'ai-accounts-usage-strip', label: () => previewLabel }, () => null)
    const releaseMenu = slots.register({ name: 'sidebar.footer.action', id: 'ai-accounts-quota', label: 'AI Accounts: Usage menu' }, () => null)
    const releaseEdge = slots.register({ name: 'sidebar.footer.action', id: 'ai-accounts-edge', label: 'AI Accounts: Edge preview' }, () => null)
    const locale = createSnapshotStore(0)
    const unsubscribe = vi.fn()
    const source = setup({
      footerTitles: slot => slots.entriesOfSlot(slot).map(entry => resolveSlotLabel(entry.options.label) ?? ''),
      subscribeFooterTitles: listener => {
        const disposers = [slots.subscribe('sidebar.footer.above', listener), slots.subscribe('sidebar.footer.action', listener), locale.subscribe(listener)]
        return () => {
          unsubscribe()
          disposers.forEach(dispose => dispose())
        }
      },
    })
    const statusId = 'dshfiles-thread-sidebar.workbench-status'
    const actionsId = 'dshfiles-thread-sidebar.workbench-actions'
    const definition = source.registry.get(statusId)
    if (definition === undefined) throw new Error('Preview source missing')
    expect(definition.title).toBe('AI Accounts: Preview')
    expect(source.registry.get(actionsId)?.title).toBe('AI Accounts: Controls')
    const Panel = definition.component
    const view = render(<Panel panelId={statusId} />)
    const section = screen.getByRole('region', { name: 'AI Accounts: Preview' })
    await act(async () => {
      await Promise.resolve()
    })
    const notify = vi.fn()
    const stopWatching = source.registry.subscribe(notify)
    act(() => {
      previewLabel = 'AI Accounts: Aperçu'
      locale.set(1)
    })
    const updated = source.registry.get(statusId)
    expect(updated?.title).toBe('AI Accounts: Aperçu')
    expect(updated?.component).toBe(Panel)
    expect(screen.getByRole('region', { name: 'AI Accounts: Aperçu' })).toBe(section)
    expect(source.decorate).toHaveBeenCalledTimes(4)
    expect(notify).toHaveBeenCalledTimes(1)
    act(() => locale.set(2))
    expect(notify).toHaveBeenCalledTimes(1)
    await act(async () => {
      releasePreview()
      await Promise.resolve()
    })
    expect(source.registry.get(statusId)?.title).toBe('Thread Sidebar: Plugin previews')
    expect(source.registry.get(statusId)?.component).toBe(Panel)
    stopWatching()
    view.unmount()
    // HMR cleanup releases both the mounted component and the adapter's subscriptions.
    source.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    expect(source.registry.list()).toEqual([])
    const replacement = { id: statusId, title: 'Replacement: Preview', component: Panel }
    source.registry.register(replacement)
    await act(async () => {
      locale.set(3)
      releaseMenu()
      releaseEdge()
      await Promise.resolve()
    })
    source.dispose()
    expect(source.registry.get(statusId)).toBe(replacement)
    releaseRoot()
  })

  it.each([
    { labels: ['AI Accounts: Preview', 'AI Accounts: Another preview'], preview: 'AI Accounts: Previews', controls: 'AI Accounts: Controls' },
    { labels: ['AI Accounts: Preview', 'Other Plugin: Preview'], preview: 'Thread Sidebar: Plugin previews', controls: 'Thread Sidebar: Plugin controls' },
    { labels: ['AI Accounts: Preview', ''], preview: 'Thread Sidebar: Plugin previews', controls: 'Thread Sidebar: Plugin controls' },
    { labels: ['Preview'], preview: 'Thread Sidebar: Plugin previews', controls: 'Thread Sidebar: Plugin controls' },
    { labels: ['AI Accounts:'], preview: 'Thread Sidebar: Plugin previews', controls: 'Thread Sidebar: Plugin controls' },
    { labels: [': Preview'], preview: 'Thread Sidebar: Plugin previews', controls: 'Thread Sidebar: Plugin controls' },
  ])('groups declared qualified prefixes without guessing ownership: $labels', ({ labels, preview, controls }) => {
    const source = setup()
    source.footerLabels.set({ 'sidebar.footer.above': labels, 'sidebar.footer.action': labels })
    expect(source.registry.get('dshfiles-thread-sidebar.workbench-status')?.title).toBe(preview)
    expect(source.registry.get('dshfiles-thread-sidebar.workbench-actions')?.title).toBe(controls)
    source.dispose()
  })

  it('uses the live reusable registry title for native Navigation links while retaining their main ids and glyph owner props', () => {
    const slots = new SlotCore()
    const releaseRoot = slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' } } }, ({ renderSlot }) =>
      renderSlot('main', {}, { entryKey: 'plugins' }),
    )
    const releaseNative = slots.register({ name: 'main', key: 'plugins' }, () => null)
    // The real main-slot registration establishes this branded navigation identity.
    const isRegisteredPanel = (id: string): id is SidebarPanelMetadata['id'] => slots.entriesOfSlot('main').some(entry => entry.options.key === id)
    const nativeId = 'plugins'
    if (!isRegisteredPanel(nativeId)) throw new Error('Native Plugins main cell missing')
    const source = setup()
    source.panels.set([{ id: nativeId, label: 'Plugins', order: 0 }])
    const definition = source.registry.get('dshfiles-thread-sidebar.workbench-navigation')
    if (definition === undefined) throw new Error('Navigation source missing')
    const Panel = definition.component
    const register = vi.spyOn(source.registry, 'register')
    const view = render(<Panel panelId={definition.id} />)
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeTruthy()
    expect(register).not.toHaveBeenCalled()
    let releaseCanonical = (): void => undefined
    act(() => {
      source.registry.register({ id: 'semantic/plugins', title: 'User occurrence title', mainPanelId: nativeId, tabId: 'tab/plugin', component: () => null })
      source.registry.register({ id: 'hidden/plugins', title: 'Hidden occurrence title', mainPanelId: nativeId, hiddenFromAdd: true, component: () => null })
      releaseCanonical = source.registry.register({ id: 'main/plugins', title: 'Plugin Manager: Plugins', mainPanelId: nativeId, component: () => null })
    })
    const button = screen.getByRole('button', { name: 'Plugin Manager: Plugins' })
    expect(register).toHaveBeenCalledTimes(3)
    expect(source.calls).toHaveBeenCalledWith('sidebar.panellist', { size: 18, active: false }, { only: nativeId })
    fireEvent.click(button)
    expect(source.selectPanel).toHaveBeenCalledWith(nativeId)
    expect(button.querySelector('span.dshx\\:truncate')?.textContent).toBe('Plugin Manager: Plugins')
    expect(button.querySelector('[title]')).toBeNull()
    act(() => releaseCanonical())
    expect(screen.getByRole('button', { name: 'Plugins' })).toBe(button)
    expect(source.registry.get(definition.id)?.component).toBe(Panel)
    view.unmount()
    source.dispose()
    releaseNative()
    releaseRoot()
  })

  it('renders a live empty Navigation assembly without inventing main identities', () => {
    const source = setup()
    const definition = source.registry.list().find(panel => panel.title === 'Thread Sidebar: Navigation')
    if (definition === undefined) throw new Error('Navigation source missing')
    const Panel = definition.component
    render(<Panel panelId={definition.id} />)
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    source.dispose()
  })
})
