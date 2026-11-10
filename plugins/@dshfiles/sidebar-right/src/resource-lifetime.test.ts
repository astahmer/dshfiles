import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it, vi } from 'vitest'
import { createSidebarRightController } from './native/client/service.ts'
import { SidebarRightTabRegistry } from './native/client/tab-registry.ts'
import { createSidebarRightStore } from './native/client/stores.ts'
import { SidebarResourcePanelModel } from './resource-panels.js'

it('preserves real per-session occurrences through target moves and invokes terminal cleanup on explicit close', async () => {
  const ctx = new Context()
  const types = new SidebarRightTabRegistry(ctx)
  types.register({ id: 'file-owner', kind: 'file', patterns: ['dsh-resource://file/**'], title: () => 'File' })
  types.register({ id: 'diff-owner', kind: 'diff', patterns: ['dsh-resource://diff/**'], title: () => 'Diff' })
  types.register({ id: 'terminal-owner', kind: 'terminal', multiple: true, title: () => 'Terminal' })
  const pin = vi.fn()
  const owner = createSidebarRightController(types, pin, {
    autoFullscreen: () => false,
    openWithFocus: (_session, open) => {
      open()
    },
    closeWithFocus: (_session, _pane, close) => {
      close()
    },
  })
  // SAFETY: deterministic fixture identities name the two real stores adopted immediately below.
  const a = 'session-a' as SessionId
  // SAFETY: distinct deterministic fixture identity names the second adopted store.
  const b = 'session-b' as SessionId
  const storeA = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
  const storeB = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
  const releaseA = owner.adopt(a, storeA)
  const releaseB = owner.adopt(b, storeB)
  const cleanup = vi.fn()
  owner.controller.registerCloseHandler('terminal', cleanup)
  owner.show(a)
  owner.controller.openResource('dsh-resource://file/session/a/test.txt')
  owner.controller.openResource('dsh-resource://diff/session/a/real-diff')
  owner.controller.openTab('terminal')
  const records = owner.controller.tabsIn(a)
  expect(records.map(row => row.kind)).toEqual(['file', 'diff', 'terminal'])
  const terminal = records.find(row => row.kind === 'terminal')
  if (terminal === undefined) throw new Error('expected a real terminal record')
  const held = owner.controller.tabDomain.occurrence(a, terminal)
  const bridge = SidebarResourcePanelModel.create()
  const rows = records.map(tab => ({
    id: SidebarResourcePanelModel.id(a, tab.id),
    sessionId: a,
    tabId: tab.id,
    kind: tab.kind,
    title: tab.title,
    address: tab.contentId,
    navigationRevision: 1,
  }))
  bridge.publish(a, rows, tabId => {
    const record = records.find(tab => tab.id === tabId)
    if (record !== undefined) owner.controller.closeIn(a, record.id)
  })
  const target = bridge.attach(SidebarResourcePanelModel.id(a, terminal.id), document.createElement('div'))
  target()
  owner.show(b)
  owner.controller.openResource('dsh-resource://file/session/b/other.txt')
  expect(owner.controller.tabsIn(b)).toHaveLength(1)
  expect(held.signal.aborted).toBe(false)
  expect(owner.controller.tabDomain.occurrence(a, terminal)).toBe(held)
  const resourceElement = document.createElement('section')
  resourceElement.dataset.sidebarResourcePanel = SidebarResourcePanelModel.id(a, terminal.id)
  resourceElement.dataset.sidebarRightSession = a
  resourceElement.dataset.sidebarRightTab = terminal.id
  resourceElement.dataset.sidebarRightOccurrence = held.id
  const terminalPane = Object.values(storeA.getSnapshot().bySession[a]?.layout.nodes ?? {}).find(
    node => node.kind === 'pane' && node.tabs.includes(terminal.id),
  )
  if (terminalPane === undefined) throw new Error('expected terminal pane')
  resourceElement.dataset.dockkitPane = terminalPane.id
  document.body.append(resourceElement)
  const targetIdentity = owner.controller.focusedTarget(resourceElement)
  expect(targetIdentity?.sessionId).toBe(a)
  if (targetIdentity === undefined) throw new Error('expected focused resource target')
  expect(owner.controller.canCloseTarget(targetIdentity)).toBe(true)
  expect(owner.controller.closeTarget(targetIdentity)).toBe('closed')
  resourceElement.remove()
  expect(cleanup).toHaveBeenCalledWith(a, terminal)
  expect(held.signal.aborted).toBe(true)
  expect(owner.controller.tabsIn(b)).toHaveLength(1)
  const terminalPin = pin.mock.calls.find(([address]) => address === terminal.contentId)
  expect(terminalPin?.[1].aborted).toBe(true)
  releaseB()
  releaseA()
  owner.controller.tabDomain.dispose()
})

it('keeps tab resources pinned only for the on-screen and previously shown sessions, and pins them again on return', () => {
  const ctx = new Context()
  const types = new SidebarRightTabRegistry(ctx)
  types.register({ id: 'aside-owner', kind: 'threadaside', patterns: ['dsh-resource://threadaside/**'], title: () => 'Thread' })
  const pins: { address: string; signal: AbortSignal }[] = []
  const owner = createSidebarRightController(types, (address, signal) => pins.push({ address, signal }), {
    autoFullscreen: () => false,
    openWithFocus: (_session, open) => {
      open()
    },
    closeWithFocus: (_session, _pane, close) => {
      close()
    },
  })
  // SAFETY: deterministic fixture identities name the real stores adopted below.
  const a = 'session-a' as SessionId
  // SAFETY: distinct deterministic fixture identity for the second adopted store.
  const b = 'session-b' as SessionId
  // SAFETY: distinct deterministic fixture identity for the third adopted store.
  const c = 'session-c' as SessionId
  const ids = [a, b, c]
  const releases = ids.map(id => owner.adopt(id, createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()))
  const live = (address: string): number => pins.filter(pin => pin.address === address && !pin.signal.aborted).length
  const asideOf = (id: SessionId): string => `dsh-resource://threadaside/session/${id}`
  for (const id of ids) {
    owner.show(id)
    owner.controller.openResource(asideOf(id))
  }
  const tabA = owner.controller.tabsIn(a)[0]
  if (tabA === undefined) throw new Error('expected the aside record of session a')
  const occurrenceA = owner.controller.tabDomain.occurrence(a, tabA)
  expect([live(asideOf(a)), live(asideOf(b)), live(asideOf(c))]).toEqual([0, 1, 1])
  expect(occurrenceA.signal.aborted).toBe(false)
  owner.show(a)
  expect([live(asideOf(a)), live(asideOf(b)), live(asideOf(c))]).toEqual([1, 0, 1])
  expect(owner.controller.tabDomain.occurrence(a, tabA)).toBe(occurrenceA)
  owner.controller.closeIn(a, tabA.id)
  expect(live(asideOf(a))).toBe(0)
  for (const release of releases) release()
  owner.controller.tabDomain.dispose()
  expect(pins.every(pin => pin.signal.aborted)).toBe(true)
})
