// @vitest-environment jsdom
import { act, createContext, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionReference, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots, SessionProviderComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchPanelDefinition } from '@dshfiles/workbench/registry'
import { ConversationWorkbenchSources, WORKBENCH_VIEW_SLOT, type ConversationWorkbenchSession } from './workbench-views.js'

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
const a = SessionId('conversation-view-a')
const b = SessionId('conversation-view-b')
const bound = createContext<string | undefined>(undefined)
const Provider: SessionProviderComponent = props => <bound.Provider value={props.session?.sessionId}>{props.children}</bound.Provider>
const Subject = (props: { readonly viewId: string }) => (
  <output>
    {useContext(bound)}:{props.viewId}
  </output>
)
const renderSlot: PropsRenderSlots<typeof WORKBENCH_VIEW_SLOT>['renderSlot'] = () => <Subject viewId="trajectory" />
const releases: Array<() => void> = []
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release()
  document.body.replaceChildren()
})

const fixture = () => {
  const sessions = createSnapshotStore<readonly ConversationWorkbenchSession[]>([
    { id: a, title: 'A' },
    { id: b, title: 'B' },
  ])
  const views = createSnapshotStore([
    { id: 'chat', label: 'Chat' },
    { id: 'trajectory', label: 'Trajectory' },
  ])
  const definitions = new Map<string, WorkbenchPanelDefinition>()
  const held: Array<{ reference: SessionReference; release: ReturnType<typeof vi.fn>; reject: (error: Error) => void }> = []
  const adapter = ConversationWorkbenchSources.create({
    sessions,
    views,
    registry: {
      register: definition => {
        definitions.set(definition.id, definition)
        return () => {
          if (definitions.get(definition.id) === definition) definitions.delete(definition.id)
        }
      },
    },
    retain: sessionId => {
      const release = vi.fn()
      let rejectReady: (error: Error) => void = () => undefined
      const ready = new Promise<SessionBinding>((_resolve, reject) => {
        rejectReady = reject
      })
      const reference: SessionReference = {
        sessionId,
        ready,
        release,
        [Symbol.dispose]: release,
        get binding(): SessionBinding {
          throw new Error('Only the real SessionProvider owns binding materialization.')
        },
      }
      held.push({ reference, release, reject: rejectReady })
      return reference
    },
  })
  releases.push(adapter.dispose)
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  releases.push(() => {
    act(() => root.unmount())
  })
  const panel = (id: typeof a) => {
    const definition = definitions.get(ConversationWorkbenchSources.id(id, 'trajectory'))
    if (definition === undefined) throw new Error('Missing real view source')
    return definition
  }
  return { adapter, sessions, views, definitions, held, element, root, panel }
}

describe('owned conversation view panel sources', () => {
  it('registers actual view identities without retaining Sessions and preserves components across titles', () => {
    const f = fixture()
    expect([...f.definitions.values()].map(x => x.title)).toEqual(['Trajectory — A', 'Trajectory — B'])
    expect([...f.definitions.values()].every(definition => definition.hiddenFromAdd === true)).toBe(true)
    expect(f.held).toHaveLength(0)
    const before = f.panel(a).component
    f.sessions.set([{ id: a, title: 'Renamed' }])
    expect(f.panel(a).component).toBe(before)
    expect([...f.definitions.values()].map(x => x.title)).toEqual(['Trajectory — Renamed'])
    f.views.set([])
    expect(f.definitions.size).toBe(0)
  })

  it('rehydrates old view panels before any main conversation mounted and binds split Sessions independently', () => {
    const f = fixture()
    const A = f.panel(a).component
    const B = f.panel(b).component
    act(() =>
      f.root.render(
        <>
          <f.adapter.Root SessionProvider={Provider} renderSlot={renderSlot} />
          <A panelId="a" />
          <B panelId="b" />
        </>,
      ),
    )
    expect(f.element.textContent).toContain(`${a}:trajectory`)
    expect(f.element.textContent).toContain(`${b}:trajectory`)
    expect(f.held.map(x => x.reference.sessionId)).toEqual([a, b])
    act(() => f.root.render(null))
    expect(f.held.every(x => x.release.mock.calls.length === 1)).toBe(true)
  })

  it('shows acquisition failure rather than borrowing the current thread and releases on close', async () => {
    const f = fixture()
    const A = f.panel(a).component
    act(() =>
      f.root.render(
        <>
          <f.adapter.Root SessionProvider={Provider} renderSlot={renderSlot} />
          <A panelId="a" />
        </>,
      ),
    )
    await act(async () => {
      f.held[0]?.reject(new Error('Session unavailable'))
      await Promise.resolve()
    })
    expect(f.element.querySelector('[role="alert"]')?.textContent).toContain('Conversation unavailable')
    expect(f.element.textContent).not.toContain(`${b}:trajectory`)
    act(() => f.root.render(null))
    expect(f.held[0]?.release).toHaveBeenCalledTimes(1)
  })
})
