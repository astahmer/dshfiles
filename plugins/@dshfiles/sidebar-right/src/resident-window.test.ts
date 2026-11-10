import { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Schema } from 'effect'
import { expect, it, vi } from 'vitest'
import { createSidebarRightController, DEFAULT_RESIDENT_THREADS } from './native/client/service.ts'
import { SidebarSessionViews } from './native/client/session-views.ts'
import { SidebarRightTabRegistry } from './native/client/tab-registry.ts'

const ids = (count: number): readonly SessionId[] =>
  Array.from({ length: count }, (_, index) => SessionId(Schema.decodeUnknownSync(Schema.String)(`session-${index}`)))

it('keeps the on-screen Session plus the four most recently shown by default, moving a re-shown one to newest', () => {
  const owner = createSidebarRightController(new SidebarRightTabRegistry(new Context()), () => {}, {
    autoFullscreen: () => false,
    openWithFocus: (_session, open) => {
      open()
    },
    closeWithFocus: (_session, _pane, close) => {
      close()
    },
  })
  const visited = ids(8)
  for (const id of visited) owner.show(id)
  const residentIds = (): readonly SessionId[] => {
    const resident = owner.resident.getSnapshot()
    return resident.all ? visited : [...resident.ids]
  }
  expect(residentIds()).toEqual(visited.slice(-(DEFAULT_RESIDENT_THREADS + 1)))
  const first = visited[0]
  if (first === undefined) throw new Error('expected a first visited Session')
  owner.show(first)
  expect(residentIds()).toEqual([...visited.slice(-(DEFAULT_RESIDENT_THREADS + 1)).slice(1), first])
  owner.controller.tabDomain.dispose()
})

it('keeps kept-mounted views only for the resident window, and every one at 0', () => {
  const releases = new Map<string, ReturnType<typeof vi.fn>>()
  const retain: ISessions['retain'] = (target, _options): SessionReference => {
    // SAFETY: this fixture accepts only the local SessionId branch; the public seam is validated here.
    const sessionId = SessionId(Schema.decodeUnknownSync(Schema.String)(target))
    const release = vi.fn()
    releases.set(sessionId, release)
    class Reference implements SessionReference {
      readonly sessionId = sessionId
      readonly ready = new Promise<SessionReference['binding']>(() => {})
      readonly release = release
      get binding(): SessionReference['binding'] {
        throw new Error('unneeded in retention test')
      }
      [Symbol.dispose](): void {
        release()
      }
    }
    return new Reference()
  }
  const views = new SidebarSessionViews({ retain })
  const [a, b, c] = ids(3)
  if (a === undefined || b === undefined || c === undefined) throw new Error('expected three fixture Sessions')
  const holdTabs = (sessionId: SessionId): void => {
    const view = views.source.getSnapshot().find(candidate => candidate.sessionId === sessionId)
    if (view === undefined) throw new Error(`expected the fixture view of ${sessionId}`)
    // SAFETY: the retained body identity is a stable fixture id at the public retainTab seam.
    view.retainTab('tab-a' as TabId, new AbortController().signal)
  }
  views.select(a)
  holdTabs(a)
  views.select(b)
  holdTabs(b)
  views.select(c)
  holdTabs(c)
  const held = (): readonly SessionId[] => views.source.getSnapshot().map(view => view.sessionId)
  expect(held()).toEqual([a, b, c])
  views.retainWithin({ all: true })
  expect(held()).toEqual([a, b, c])
  views.retainWithin({ all: false, ids: new Set([b, c]) })
  expect(held()).toEqual([b, c])
  expect(releases.get(a)).toHaveBeenCalledOnce()
  expect(releases.get(b)).not.toHaveBeenCalled()
  views.retainWithin({ all: false, ids: new Set([c]) })
  expect(held()).toEqual([c])
  expect(releases.get(b)).toHaveBeenCalledOnce()
  views.dispose()
})
