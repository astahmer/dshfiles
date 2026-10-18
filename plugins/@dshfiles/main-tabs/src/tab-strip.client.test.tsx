// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MainTabsTranslate } from './locales.js'
import { OPEN_THREAD_ASIDE_EVENT } from './thread-aside.js'
import { TabStrip, type TabView } from './tab-strip.js'

const labels = {
  closeTab: 'Close tab',
  copyThreadId: 'Copy thread ID',
  copyThreadLink: 'Copy thread link',
  openInSidePanel: 'Open in side panel',
  sidePanelUnavailable: 'The side panel is not available here.',
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

afterEach(() => {
  cleanup()
  window.removeEventListener(OPEN_THREAD_ASIDE_EVENT, onAsideRequest)
  asideRequests.length = 0
  window.history.replaceState({}, '', '/')
})

const openContextMenu = (tab: HTMLElement): void => {
  fireEvent.contextMenu(tab, { clientX: 20, clientY: 20 })
}

const mount = () => render(<TabStrip tabs={tabs} send={() => {}} t={t} newTabKeys="" />)

const asideRequests: { readonly detail: unknown; readonly cancelable: boolean }[] = []
const onAsideRequest = (event: Event): void => {
  asideRequests.push({ detail: (event as CustomEvent).detail, cancelable: event.cancelable })
  event.preventDefault()
}

const openAsideFromMenu = async (): Promise<void> => {
  openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in side panel' }))
}

describe('TabStrip thread actions', () => {
  it('offers copy actions in thread tab menus', async () => {
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Thread, Working' }))
    await screen.findByRole('menuitem', { name: 'Copy thread ID' })
    expect(screen.getByRole('menuitem', { name: 'Copy thread link' })).toBeDefined()
  })

  it('omits thread copy actions from panel tab menus', async () => {
    mount()

    openContextMenu(screen.getByRole('tab', { name: 'Workbench' }))
    await screen.findByRole('menuitem', { name: 'Close tab' })
    expect(screen.queryByRole('menuitem', { name: 'Copy thread ID' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Copy thread link' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Open in side panel' })).toBeNull()
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
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy thread ID' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Could not access the clipboard.'))
  })
})
