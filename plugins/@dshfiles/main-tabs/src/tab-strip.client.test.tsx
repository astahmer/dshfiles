// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MainTabsTranslate } from './locales.js'
import { OPEN_THREAD_ASIDE_EVENT } from './thread-aside.js'
import { PANEL_ASIDE_EVENT } from './panel-aside.js'
import { THREAD_MENTION_INSERT_EVENT, ThreadMentionDrag } from '@dshfiles/thread-sidebar/thread-mention'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { TabStrip, type TabView } from './tab-strip.js'
import type { CloseButtonPosition } from '@dshfiles/workbench/tabs'
import { SETTLE_THREAD_EVENT } from './settle-request.js'
import type { TabsEvent } from './tabs-machine.js'

const labels = {
  mentionThread: '@Mention thread',
  settleThread: 'Settle thread',
  threadStatus: 'Change status',
  copy: 'Copy',
  close: 'Close tab',
  closeTab: 'Close tab',
  copyThreadId: 'Copy thread ID',
  copyThreadLink: 'Copy thread link',
  renameThread: 'Edit title',
  renameFailed: 'Could not rename the thread.',
  openInSidePanel: 'Open in side panel',
  openPluginInSidePanel: 'Open plugin in side panel',
  moveToSidePanel: 'Move to side panel',
  sidePanelUnavailable: 'The side panel is not available here.',
  panelAsideUnavailable: 'This panel has no side-panel view while no thread is on screen.',
  clipboardFailure: 'Could not access the clipboard.',
  running: 'Working',
} satisfies Readonly<Record<string, string>>

const labelFor = (key: string): string => Object.entries(labels).find(([label]) => label === key)?.[1] ?? key
const t: MainTabsTranslate = key => labelFor(key)

const tabs = [
  {
    id: 'thread:thread-1',
    kind: 'thread',
    sessionId: 'thread-1',
    workspaceId: 'workspace-1',
    title: 'Thread',
    active: true,
    pinned: false,
    preview: false,
    available: true,
    status: 'running',
  },
  {
    id: 'panel:workbench',
    kind: 'panel',
    panelId: 'dshfiles-workbench',
    title: 'Workbench',
    active: false,
    pinned: false,
    preview: false,
    available: true,
    status: null,
  },
] satisfies readonly TabView[]

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  HTMLElement.prototype.scrollIntoView ??= () => {}
})

const registeredPanelDisposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of registeredPanelDisposers.splice(0)) dispose()
  cleanup()
  window.removeEventListener(OPEN_THREAD_ASIDE_EVENT, onAsideRequest)
  window.removeEventListener(PANEL_ASIDE_EVENT, onAsideRequest)
  window.removeEventListener(SETTLE_THREAD_EVENT, onSettleRequest)
  settleRequests.length = 0
  asideRequests.length = 0
  Reflect.deleteProperty(document, 'elementFromPoint')
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
})

/** A native drag event jsdom does not build itself: React reads only the transfer and the pointer position. */
const dragEvent = (type: string): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: 'none', dropEffect: 'none', setData: (): void => {} } })
  Object.defineProperty(event, 'clientX', { value: 900 })
  Object.defineProperty(event, 'clientY', { value: 200 })
  return event
}

/** The frame's right column with DSH's native right sidebar inside it, hit-testing to the panel as a browser would. */
const seedRightSidebar = (): HTMLElement => {
  const column = document.createElement('div')
  column.setAttribute('data-rightbar-col', '')
  const outlet = document.createElement('div')
  outlet.setAttribute('data-slot', 'rightbar')
  const panel = document.createElement('div')
  column.append(outlet)
  outlet.append(panel)
  document.body.append(column)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => panel })
  return column
}

const openContextMenu = (tab: HTMLElement): void => {
  fireEvent.contextMenu(tab, { clientX: 20, clientY: 20 })
}

const mount = (
  send: (event: TabsEvent) => void = () => {},
  renameThread: (sessionId: string, title: string) => Promise<void> = async () => {},
  tabViews: readonly TabView[] = tabs,
  closeButtonPosition?: CloseButtonPosition,
) =>
  render(
    <TabStrip
      tabs={tabViews}
      send={send}
      t={t}
      newTabKeys=""
      renameThread={renameThread}
      {...(closeButtonPosition === undefined ? {} : { closeButtonPosition })}
    />,
  )

const settleRequests: { readonly detail: unknown; readonly cancelable: boolean }[] = []
const onSettleRequest = (event: Event): void => {
  settleRequests.push({ detail: event instanceof CustomEvent ? event.detail : undefined, cancelable: event.cancelable })
  event.preventDefault()
}

const asideRequests: { readonly detail: unknown; readonly cancelable: boolean }[] = []
const onAsideRequest = (event: Event): void => {
  asideRequests.push({ detail: event instanceof CustomEvent ? event.detail : undefined, cancelable: event.cancelable })
  event.preventDefault()
}

const openAsideFromMenu = async (): Promise<void> => {
  openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in side panel' }))
}

describe('TabStrip layout', () => {
  it('keeps a 16 px status seat on a thread tab whether or not it has a status, so the title never moves', () => {
    // The glyph mounted only with a status, and the title moved 24 px each time a thread started or stopped (F13).
    const idle = tabs.map(tab => (tab.kind === 'thread' ? { ...tab, status: null } : tab))
    const { unmount } = mount(undefined, undefined, idle)
    const seat = (): Element | null => document.querySelector('[data-tab-status-slot]')
    expect(seat()?.className).toContain('dshx:size-4')
    expect(seat()?.childElementCount).toBe(0)
    unmount()
    mount()
    expect(seat()?.className).toContain('dshx:size-4')
    expect(seat()?.childElementCount).toBe(1)
    expect(document.querySelectorAll('[data-tab-status-slot]')).toHaveLength(1)
  })

  it('marks a preview tab with a muted title instead of italics', () => {
    mount(
      undefined,
      undefined,
      tabs.map(tab => (tab.kind === 'panel' ? { ...tab, preview: true } : tab)),
    )
    const title = screen.getByText('Workbench')
    expect(title.className).not.toContain('italic')
    expect(title.className).toContain('dshx:text-(--dsw-alias-label-tertiary)')
    expect(screen.getByText('Thread').className).not.toContain('dshx:text-(--dsw-alias-label-tertiary)')
  })

  it('draws the shared status glyph on a thread tab and never a coloured dot of its own', () => {
    const withStatus = (status: TabView['status']): readonly TabView[] => tabs.map(tab => (tab.kind === 'thread' ? { ...tab, status } : tab))
    const view = mount()
    const glyph = () => view.container.querySelector('[role="tab"] [data-slot="status-glyph"]')
    expect(glyph()?.getAttribute('data-status')).toBe('working')
    expect(view.container.innerHTML).not.toMatch(/bg-info|bg-warning|animate-pulse/)
    const draw = (status: TabView['status']): void =>
      view.rerender(<TabStrip tabs={withStatus(status)} send={() => {}} t={t} newTabKeys="" renameThread={async () => {}} />)
    draw('needsYou')
    expect(glyph()?.getAttribute('data-status')).toBe('needs-you')
    expect(view.container.innerHTML).not.toMatch(/bg-info|bg-warning|animate-pulse/)
    draw('failed')
    expect(glyph()?.getAttribute('data-status')).toBe('failed')
    expect(screen.getByRole('tab', { name: 'Thread, failed' })).toBeDefined()
    draw('unread')
    expect(glyph()?.getAttribute('data-status')).toBe('ready')
    draw(null)
    expect(glyph()).toBeNull()
  })

  it('places the close button on either side of the title and preserves close behavior', () => {
    const send = vi.fn()
    mount(send, async () => {}, tabs, 'left')
    const leftTab = screen.getByRole('tab', { name: 'Thread, Working' })
    const leftClose = within(leftTab).getByRole('button', { name: 'Close tab' })
    const leftTitle = within(leftTab).getByText('Thread')
    expect(leftClose.compareDocumentPosition(leftTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(leftClose)
    expect(send).toHaveBeenNthCalledWith(1, { type: 'tab.close', tabId: 'thread:thread-1' })

    cleanup()
    mount(send)
    const rightTab = screen.getByRole('tab', { name: 'Thread, Working' })
    const rightClose = within(rightTab).getByRole('button', { name: 'Close tab' })
    const rightTitle = within(rightTab).getByText('Thread')
    expect(rightTitle.compareDocumentPosition(rightClose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(rightClose)
    fireEvent(rightTab, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(send).toHaveBeenNthCalledWith(2, { type: 'tab.close', tabId: 'thread:thread-1' })
    expect(send).toHaveBeenNthCalledWith(3, { type: 'tab.close', tabId: 'thread:thread-1' })

    cleanup()
    const pinnedTabs = tabs.map(tab => ({ ...tab, pinned: true }))
    mount(send, async () => {}, pinnedTabs)
    expect(within(screen.getByRole('tab', { name: 'Thread, Working' })).queryByRole('button', { name: 'Close tab' })).toBeNull()
  })

  it('keeps the close button visible on an inactive tab', () => {
    render(<TabStrip tabs={tabs} send={() => {}} t={t} newTabKeys="" renameThread={async () => {}} />)
    const inactive = screen.getByRole('tab', { name: 'Workbench' })
    const close = within(inactive).getByRole('button', { name: 'Close tab' })
    expect(close.className).not.toContain('dshx:opacity-0')
    expect(close.className).not.toContain('dshx:pointer-events-none')
  })

  it('lets long tab titles shrink inside the capped tab width', () => {
    const longTitle = 'A conversation title that is much wider than the tab strip should allow'
    const longTabs = tabs.map(tab => (tab.id === 'thread:thread-1' ? { ...tab, title: longTitle } : tab))
    mount(
      () => {},
      async () => {},
      longTabs,
    )

    const title = screen.getByText(longTitle)

    expect(title.className).toContain('dshx:min-w-0')
    expect(title.className).toContain('dshx:flex-1')
    expect(title.className).toContain('dshx:truncate')
  })

  it('sizes tabs to their titles and hides project names by default', () => {
    mount()
    const tab = screen.getByRole('tab', { name: 'Thread, Working' })
    expect(tab.className).toContain('dshx:max-w-[190px]')
    expect(tab.className).not.toContain('dshx:w-[160px]')
    expect(tab.querySelector('[data-tab-project]')).toBeNull()
  })

  it('answers a tap or click on a tab with the accent fill within the hover duration (80ms)', () => {
    mount()
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('dshx:active:bg-accent')
      expect(tab.className).toContain('dshx:duration-(--dshx-duration-hover)')
    }
  })

  it('gives every tab the same width when fixed width is on', () => {
    render(<TabStrip tabs={tabs} send={() => {}} t={t} newTabKeys="" renameThread={async () => {}} fixedWidth />)
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('dshx:w-[160px]')
      expect(tab.className).toContain('dshx:flex-none')
    }
  })

  it('shows the project name as a chip before thread titles only', () => {
    render(<TabStrip tabs={tabs} send={() => {}} t={t} newTabKeys="" renameThread={async () => {}} projectNames={new Map([['workspace-1', 'dshfiles']])} />)
    const thread = screen.getByRole('tab', { name: 'dshfiles / Thread, Working' })
    expect(within(thread).getByText('dshfiles')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Workbench' }).querySelector('[data-tab-project]')).toBeNull()
  })

  it('keeps a custom chip colour readable by clamping its text lightness in each scheme', () => {
    render(
      <TabStrip
        tabs={tabs}
        send={() => {}}
        t={t}
        newTabKeys=""
        renameThread={async () => {}}
        projectNames={new Map([['workspace-1', 'dshfiles']])}
        projectChips={{ 'workspace-1': { color: '#ffd400' } }}
      />,
    )
    const chip = within(screen.getByRole('tab', { name: 'dshfiles / Thread, Working' })).getByText('dshfiles')
    expect(chip.style.getPropertyValue('--chip')).toBe('#ffd400')
    expect(chip.style.color).toBe('')
    expect(chip.style.getPropertyValue('--chip-light')).toBe('oklch(from var(--chip) min(l, 0.52) c h)')
    expect(chip.style.getPropertyValue('--chip-dark')).toBe('oklch(from var(--chip) max(l, 0.78) c h)')
    expect(chip.className).toContain('dshx:text-(--chip-light)')
    expect(chip.className).toContain('dshx:dark:text-(--chip-dark)')
  })
})

describe('TabStrip thread actions', () => {
  it('offers copy actions in thread tab menus', async () => {
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Change status' })).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: 'Copy thread ID' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Settle thread' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(await screen.findByRole('menuitem', { name: 'Copy thread ID' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Copy thread link' })).toBeDefined()
  })

  it('settles an idle thread from its tab menu through thread-sidebar', async () => {
    const idleTabs = tabs.map(tab => (tab.kind === 'thread' ? { ...tab, status: null } : tab))
    window.addEventListener(SETTLE_THREAD_EVENT, onSettleRequest)
    mount(
      () => {},
      async () => {},
      idleTabs,
    )

    openContextMenu(screen.getByRole('tab', { name: 'Thread' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change status' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settle thread' }))

    expect(settleRequests).toEqual([{ detail: { sessionId: 'thread-1' }, cancelable: true }])
  })

  it('renames a thread from its tab menu', async () => {
    const renameThread = vi.fn(async () => {})
    mount(() => {}, renameThread)

    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit title' }))
    const input = await screen.findByRole('textbox', { name: 'Edit title' })
    fireEvent.change(input, { target: { value: 'Renamed thread' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(renameThread).toHaveBeenCalledWith('thread-1', 'Renamed thread'))
  })

  it('cancels a tab title edit on Escape', async () => {
    const renameThread = vi.fn(async () => {})
    mount(() => {}, renameThread)

    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit title' }))
    fireEvent.keyDown(await screen.findByRole('textbox', { name: 'Edit title' }), { key: 'Escape' })

    expect(screen.queryByRole('textbox', { name: 'Edit title' })).toBeNull()
    expect(renameThread).not.toHaveBeenCalled()
  })

  it('omits thread copy actions from panel tab menus', async () => {
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Workbench' }))
    await screen.findByRole('menuitem', { name: 'Close tab' })
    expect(screen.queryByRole('menuitem', { name: 'Copy thread ID' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Copy thread link' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Open in side panel' })).toBeTruthy()
  })

  it('opens a selected registered plugin and hides it when its context-menu preference is off', async () => {
    const registry = workbenchPanels()
    registeredPanelDisposers.push(
      registry.register({
        id: 'test.backlog-panel',
        title: 'Backlog',
        component: () => null,
        showInContextMenu: true,
      }),
    )
    window.addEventListener(PANEL_ASIDE_EVENT, onAsideRequest)
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open plugin in side panel' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Backlog' }))
    expect(asideRequests).toEqual([{ detail: { panelId: 'test.backlog-panel' }, cancelable: true }])

    const preference = registry.preference('test.backlog-panel')
    if (preference === undefined) throw new Error('The registered panel has no preference.')
    registry.setPreference('test.backlog-panel', { ...preference, contextMenu: false })
    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    expect(screen.queryByRole('menuitem', { name: 'Open plugin in side panel' })).toBeNull()
  })

  it('asks the side panel for a thread tab and stays quiet when it takes it', async () => {
    window.addEventListener(OPEN_THREAD_ASIDE_EVENT, onAsideRequest)
    mount()

    await openAsideFromMenu()

    expect(asideRequests).toEqual([{ detail: { sessionId: 'thread-1' }, cancelable: true }])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says the side panel is unavailable when no plugin takes the request', async () => {
    mount()

    await openAsideFromMenu()

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The side panel is not available here.'))
  })

  it('announces clipboard failures accessibly', async () => {
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Copy' }), { key: 'ArrowRight' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy thread ID' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Could not access the clipboard.'))
  })
})

describe('TabStrip thread mentions', () => {
  it('mentions a thread from its tab menu into the stage composer', async () => {
    const requests: unknown[] = []
    const onMention = (event: Event): void => {
      requests.push(event instanceof CustomEvent ? event.detail : undefined)
    }
    window.addEventListener(THREAD_MENTION_INSERT_EVENT, onMention)
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '@Mention thread' }))

    // Unaddressed: the composer of the Session the stage shows takes it (thread-sidebar's composerTakesInsert).
    expect(requests).toEqual([{ sessionId: 'thread-1' }])
    window.removeEventListener(THREAD_MENTION_INSERT_EVENT, onMention)
  })

  it('omits the mention action from panel tab menus', async () => {
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Workbench' }))
    await screen.findByRole('menuitem', { name: 'Close tab' })
    expect(screen.queryByRole('menuitem', { name: '@Mention thread' })).toBeNull()
  })

  it('puts a dragged thread tab on the mention drag type and keeps plain text for panel tabs', () => {
    const stored = new Map<string, string>()
    const transfer = {
      effectAllowed: 'none',
      get types(): readonly string[] {
        return [...stored.keys()]
      },
      setData: (format: string, value: string): void => {
        stored.set(format, value)
      },
      getData: (format: string): string => stored.get(format) ?? '',
    }
    const dragEventWith = (type: string): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      return event
    }
    mount()

    screen.getByRole('tab', { name: 'Thread, Working' }).dispatchEvent(dragEventWith('dragstart'))
    expect(ThreadMentionDrag.read(transfer)).toBe('thread-1')
    expect(stored.has('text/plain')).toBe(false)
    expect(transfer.effectAllowed).toBe('copyMove')

    stored.clear()
    transfer.effectAllowed = 'none'
    screen.getByRole('tab', { name: 'Workbench' }).dispatchEvent(dragEventWith('dragstart'))
    expect(ThreadMentionDrag.read(transfer)).toBeNull()
    expect(stored.get('text/plain')).toBe('Workbench')
    expect(transfer.effectAllowed).toBe('move')
  })
})

describe('TabStrip side panel drop', () => {
  it('moves a dragged thread tab into the right side panel and closes its main tab', async () => {
    window.addEventListener(OPEN_THREAD_ASIDE_EVENT, onAsideRequest)
    const send = vi.fn()
    mount(send)
    const column = seedRightSidebar()
    const panel = column.querySelector<HTMLElement>('[data-slot="rightbar"] > *')
    if (panel === null) throw new Error('The seeded side panel is missing.')

    screen.getByRole('tab', { name: 'Thread, Working' }).dispatchEvent(dragEvent('dragstart'))
    panel.dispatchEvent(dragEvent('dragover'))

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Move to side panel')
    expect(column.hasAttribute('data-dshfiles-aside-drop')).toBe(true)

    panel.dispatchEvent(dragEvent('drop'))

    expect(asideRequests).toEqual([{ detail: { sessionId: 'thread-1' }, cancelable: true }])
    expect(send).toHaveBeenCalledWith({ type: 'tab.close', tabId: 'thread:thread-1' })
    expect(column.hasAttribute('data-dshfiles-aside-drop')).toBe(false)
    await waitFor(() => expect(screen.queryByText('Move to side panel')).toBeNull())
  })

  it('keeps the main tab and says the side panel is unavailable when nobody takes the drop', async () => {
    const send = vi.fn()
    mount(send)
    const panel = seedRightSidebar().querySelector<HTMLElement>('[data-slot="rightbar"] > *')
    if (panel === null) throw new Error('The seeded side panel is missing.')

    screen.getByRole('tab', { name: 'Thread, Working' }).dispatchEvent(dragEvent('dragstart'))
    panel.dispatchEvent(dragEvent('dragover'))
    panel.dispatchEvent(dragEvent('drop'))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The side panel is not available here.'))
    expect(send).not.toHaveBeenCalled()
  })

  it('moves a dragged panel tab into the side panel once its plugin answers, and closes its main tab', async () => {
    const send = vi.fn()
    mount(send)
    const column = seedRightSidebar()
    const panel = column.querySelector<HTMLElement>('[data-slot="rightbar"] > *')
    if (panel === null) throw new Error('The seeded side panel is missing.')
    const requests: unknown[] = []
    const onPanelAside = (event: Event): void => {
      requests.push(event instanceof CustomEvent ? event.detail : undefined)
      event.preventDefault()
    }
    window.addEventListener(PANEL_ASIDE_EVENT, onPanelAside)

    screen.getByRole('tab', { name: 'Workbench' }).dispatchEvent(dragEvent('dragstart'))
    panel.dispatchEvent(dragEvent('dragover'))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Move to side panel')
    panel.dispatchEvent(dragEvent('drop'))

    expect(requests).toEqual([{ panelId: 'dshfiles-workbench' }])
    expect(send).toHaveBeenCalledWith({ type: 'tab.close', tabId: 'panel:workbench' })
    window.removeEventListener(PANEL_ASIDE_EVENT, onPanelAside)
  })

  it('keeps a panel tab and says it has no side-panel view when nobody answers the drop', async () => {
    const send = vi.fn()
    mount(send)
    const panel = seedRightSidebar().querySelector<HTMLElement>('[data-slot="rightbar"] > *')
    if (panel === null) throw new Error('The seeded side panel is missing.')

    screen.getByRole('tab', { name: 'Workbench' }).dispatchEvent(dragEvent('dragstart'))
    panel.dispatchEvent(dragEvent('dragover'))
    panel.dispatchEvent(dragEvent('drop'))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('This panel has no side-panel view while no thread is on screen.'))
    expect(send).not.toHaveBeenCalled()
  })
})
