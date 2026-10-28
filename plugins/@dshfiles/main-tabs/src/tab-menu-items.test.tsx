import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import type { MainTabsTranslate } from './locales.js'
import { TabMenuItems } from './tab-menu-items.js'
import { OPEN_THREAD_ASIDE_EVENT } from './thread-aside.js'
import { PANEL_ASIDE_EVENT } from './panel-aside.js'
import type { TabView } from './workbench-tabs.js'

const thread: TabView = {
  id: 'thread:a',
  kind: 'thread',
  sessionId: 'a',
  title: 'Thread',
  active: true,
  pinned: true,
  preview: false,
  available: true,
  status: null,
}
const panel: TabView = {
  id: 'panel:jujutsu#one',
  kind: 'panel',
  panelId: 'jujutsu',
  title: 'Jujutsu',
  active: false,
  pinned: false,
  preview: false,
  available: true,
  status: null,
}
const t: MainTabsTranslate = key => key
const disposers: (() => void)[] = []
afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0)) dispose()
})

const mount = (tab: TabView, moveAside?: (tabId: string) => boolean) => {
  const send = vi.fn()
  const onStatus = vi.fn()
  const legacy = vi.fn((event: Event) => event.preventDefault())
  window.addEventListener(OPEN_THREAD_ASIDE_EVENT, legacy)
  window.addEventListener(PANEL_ASIDE_EVENT, legacy)
  disposers.push(() => {
    window.removeEventListener(OPEN_THREAD_ASIDE_EVENT, legacy)
    window.removeEventListener(PANEL_ASIDE_EVENT, legacy)
  })
  render(
    <ContextMenu>
      <ContextMenuTrigger>Tab</ContextMenuTrigger>
      <ContextMenuContent>
        <TabMenuItems tab={tab} tabs={[thread, panel]} send={send} t={t} onRename={() => {}} onStatus={onStatus} moveAside={moveAside} />
      </ContextMenuContent>
    </ContextMenu>,
  )
  fireEvent.contextMenu(screen.getByText('Tab'), { clientX: 20, clientY: 20 })
  return { send, onStatus, legacy }
}

it.each([thread, panel])('routes the real $kind aside menu through the semantic move action without opening a native clone', async tab => {
  const moveAside = vi.fn(() => true)
  const view = mount(tab, moveAside)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'openInSidePanel' }))
  expect(moveAside).toHaveBeenCalledExactlyOnceWith(tab.id)
  expect(view.legacy).not.toHaveBeenCalled()
  expect(view.send).not.toHaveBeenCalled()
})

it('does not fall back to a native clone when semantic docking is declined', async () => {
  const moveAside = vi.fn(() => false)
  const view = mount(thread, moveAside)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'openInSidePanel' }))
  expect(view.legacy).not.toHaveBeenCalled()
  expect(view.send).not.toHaveBeenCalled()
  expect(view.onStatus).toHaveBeenCalledExactlyOnceWith('sidePanelUnavailable')
})

it.each([thread, panel])('keeps the native strip $kind independent-pane behavior when no override is supplied', async tab => {
  const view = mount(tab)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'openInSidePanel' }))
  expect(view.legacy).toHaveBeenCalledTimes(1)
  expect(view.send).not.toHaveBeenCalled()
})
