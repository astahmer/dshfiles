import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createRenderedStores } from './native/client/rendered-stores.ts'
import { createSidebarRightController } from './native/client/service.ts'
import { createSidebarRightStore } from './native/client/stores.ts'
import { SidebarRightTabRegistry } from './native/client/tab-registry.ts'

const releases: (() => void)[] = []
beforeEach(() => localStorage.clear())
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release()
  localStorage.clear()
})

// SAFETY: a stable fixture identity for a Session whose store is real.
const thread = 'returning-thread' as SessionId

/** index.ts's wiring: the renderer creates through `rendered.create`, the controller mints through `rendered.mint`. */
const sidebar = () => {
  const types = new SidebarRightTabRegistry(new Context())
  types.register({ id: 'browser-owner', kind: 'browser', title: () => 'Browser', multiple: true })
  types.register({ id: 'guide-owner', kind: 'guide', title: () => 'Guide' })
  const handle = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' }))
  const adoptions = new Map<SessionId, () => void>()
  const created: SessionId[] = []
  const rendered = createRenderedStores({
    create: sessionId => {
      created.push(sessionId)
      return handle.create(sessionId)
    },
    bind: (sessionId, instance) => {
      adoptions.get(sessionId)?.()
      adoptions.set(sessionId, owner.adopt(sessionId, instance))
    },
  })
  const owner = createSidebarRightController(types, () => {}, {
    autoFullscreen: () => false,
    openWithFocus: (_session, open) => {
      open()
    },
    closeWithFocus: (_session, _pane, close) => {
      close()
    },
    mint: rendered.mint,
  })
  releases.push(() => owner.controller.tabDomain.dispose())
  releases.push(() => {
    for (const release of adoptions.values()) release()
  })
  /** A retired Sidebar view releases its adoption while the renderer keeps the instance for the live Context. */
  const retireView = (sessionId: SessionId): void => {
    adoptions.get(sessionId)?.()
    adoptions.delete(sessionId)
  }
  return { ...owner, rendered, created, retireView }
}

const tabKinds = (instance: ReturnType<ReturnType<typeof createSidebarRightStore>['create']>) =>
  Object.values(instance.getSnapshot().bySession[thread]?.layout.tabs ?? {}).map(tab => tab.kind)

it('opens into the store its seat still renders after the thread left and came back', () => {
  const owner = sidebar()
  const seatStore = owner.rendered.create(thread)
  owner.show(thread)
  owner.show(undefined)
  owner.retireView(thread)
  owner.show(thread)
  owner.controller.openTab('browser')
  expect(owner.created).toEqual([thread])
  expect(tabKinds(seatStore)).toContain('browser')
})

it('creates a store for a Session the renderer never rendered', () => {
  const owner = sidebar()
  owner.show(thread)
  owner.controller.openTab('browser')
  expect(owner.created).toEqual([thread])
  expect(owner.controller.tabsIn(thread).map(tab => tab.kind)).toContain('browser')
})

it('creates afresh once a cleared Session is forgotten', () => {
  const owner = sidebar()
  owner.rendered.create(thread)
  owner.retireView(thread)
  owner.rendered.forget(thread)
  owner.show(thread)
  owner.controller.openTab('browser')
  expect(owner.created).toEqual([thread, thread])
})
