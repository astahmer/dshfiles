import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createSidebarRightController, SidebarRightUnavailableError } from './native/client/service.ts'
import { createSidebarRightStore } from './native/client/stores.ts'
import { SidebarRightTabRegistry } from './native/client/tab-registry.ts'

const releases: (() => void)[] = []
beforeEach(() => localStorage.clear())
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release()
  localStorage.clear()
})

// SAFETY: a stable fixture identity for a Session whose store is real.
const linked = 'linked-session' as SessionId
// SAFETY: a stable fixture identity for a Session whose store is real.
const selected = 'selected-session' as SessionId
const address = 'dsh-resource://file/session/linked-session/t3code-parity.md'

/** The plugin's own wiring: `mint` creates the seat's persisted store and adopts it, as index.ts does. */
const sidebar = () => {
  const types = new SidebarRightTabRegistry(new Context())
  types.register({ id: 'file-owner', kind: 'file', patterns: ['dsh-resource://file/**'], title: () => 'File' })
  types.register({ id: 'guide-owner', kind: 'guide', title: () => 'Guide' })
  const handle = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' }))
  const minted: SessionId[] = []
  const owner = createSidebarRightController(types, () => {}, {
    autoFullscreen: () => false,
    openWithFocus: (_session, open) => {
      open()
    },
    closeWithFocus: (_session, _pane, close) => {
      close()
    },
    mint: sessionId => {
      minted.push(sessionId)
      releases.push(owner.adopt(sessionId, handle.create(sessionId)))
    },
  })
  releases.push(() => owner.controller.tabDomain.dispose())
  return { ...owner, handle, minted }
}

it('opens a conversation link in its own Session when no Session is on screen', () => {
  const owner = sidebar()
  expect(() => owner.controller.openResource(address)).toThrow(SidebarRightUnavailableError)
  owner.controller.openResourceFor(linked, address)
  expect(owner.minted).toEqual([linked])
  expect(owner.controller.mounted.getSnapshot()).toBe(linked)
  const [tab] = owner.controller.tabsIn(linked)
  expect(tab?.contentId).toBe(address)
  if (tab === undefined) throw new Error('expected the opened file tab')
  expect(owner.controller.tabDomain.occurrence(linked, tab).navigation.getSnapshot().address).toBe(address)
  // The seat later mints its own store from the same persisted layout.
  expect(owner.handle.create(linked).getSnapshot().bySession[linked]?.layout.tabs[tab.id]?.contentId).toBe(address)
})

it('mints the on-screen Session store before its seat renders and keeps it on screen', () => {
  const owner = sidebar()
  owner.show(selected)
  owner.controller.openResourceFor(linked, address)
  owner.controller.openResource('dsh-resource://file/session/selected-session/readme.md')
  expect(owner.minted).toEqual([selected])
  expect(owner.controller.mounted.getSnapshot()).toBe(selected)
  expect(owner.controller.tabsIn(selected).map(tab => tab.contentId)).toEqual([address, 'dsh-resource://file/session/selected-session/readme.md'])
  expect(owner.controller.tabsIn(linked)).toEqual([])
})

it('reports a recoverable error when no Session can receive the open', () => {
  const types = new SidebarRightTabRegistry(new Context())
  const owner = createSidebarRightController(types, () => {}, {
    autoFullscreen: () => false,
    openWithFocus: () => {},
    closeWithFocus: () => {},
  })
  releases.push(() => owner.controller.tabDomain.dispose())
  expect(() => owner.controller.openResourceFor(linked, address)).toThrow('Open a thread, then try again.')
  expect(owner.controller.mounted.getSnapshot()).toBeUndefined()
})
