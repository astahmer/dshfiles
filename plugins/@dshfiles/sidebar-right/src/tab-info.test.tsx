import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { act, useMemo, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SidebarRightTabActions, SidebarRightTabNavigation } from './native/client/contract/slots.ts'
import { createSidebarRightStore } from './native/client/stores.ts'
import { tabInfoFactory, type TabHookContext } from './native/client/tab-info.ts'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
  vi.unstubAllGlobals()
})

// SAFETY: fixture identity of the one genuine per-Session store created below.
const sessionId = 'tab-info-session' as SessionId
const navigation: SidebarRightTabNavigation = { address: 'guide', params: undefined, revision: 0 }

it('re-reads tab visibility when its occurrence becomes active after mounting hidden', () => {
  const store = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create(sessionId)
  act(() => store.actions.setExpanded(sessionId, true))
  const layout = store.getSnapshot().bySession[sessionId]?.layout
  const tabId = Object.keys(layout?.tabs ?? {})[0]
  if (tabId === undefined) throw new Error('expected the seeded guide tab')
  const useStore: TabHookContext['useStore'] = select => select(useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot))
  const baseContext: Omit<TabHookContext, 'active'> = {
    shortcuts: [],
    // SAFETY: the id was read from the store's own committed layout.
    tabId: tabId as TabId,
    title: false,
    fullscreen: false,
    embedded: true,
    signal: new AbortController().signal,
    // SAFETY: visibility never dispatches a tab action.
    actions: {} as SidebarRightTabActions,
    useStore,
    useTabNavigation: () => navigation,
  }
  // SAFETY: tabInfoFactory reads only sessionId from the standard props.
  const standard = { sessionId } as Parameters<typeof tabInfoFactory>[0]
  // The renderer rebinds the factory whenever the occurrence's hook context changes, at the same hook position.
  const Probe = (props: { readonly active: boolean }) => {
    const useTabInfo = useMemo(() => tabInfoFactory(standard, { ...baseContext, active: props.active }), [props.active])
    return <output data-visible={String(useTabInfo().tab.visible)} />
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<Probe active={false} />))
  expect(host.querySelector('output')?.dataset.visible).toBe('false')
  act(() => root.render(<Probe active />))
  expect(host.querySelector('output')?.dataset.visible).toBe('true')
  act(() => root.unmount())
})
