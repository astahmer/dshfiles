// @vitest-environment jsdom
import type * as React from 'react'
import { useRef, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodeReference } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '../src/native/contract/chat-nodes.ts'
import type { ChatNodeStore } from '../src/native/contract/snapshot.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const Icon = () => null
  return {
    IconAgentPresetOutlineRegular: Icon,
    IconApiOutlineRegular: Icon,
    IconBrowseOutlineRegular: Icon,
    IconChevronDownOutlineRegular: Icon,
    IconChevronUpOutlineRegular: Icon,
    IconCodeOutlineRegular: Icon,
    IconEditOutlineRegular: Icon,
    IconGlobeOutlineRegular: Icon,
    IconPlanOutlineRegular: Icon,
    IconQuestionOutlineRegular: Icon,
    IconSearchOutlineRegular: Icon,
    IconSparkleRegular: Icon,
    IconThinkOutlineRegular: Icon,
    TextShimmer: ({ children, className }: { children?: React.ReactNode; className?: string }) => <span className={className}>{children}</span>,
  }
})

vi.mock('../src/native/chat/ChatNodeSeat.tsx', () => ({
  ChatNodeSeat: ({ nodeKey }: { nodeKey: string }) => <div data-testid="row">{nodeKey}</div>,
}))

const { GroupMembers } = await import('../src/native/chat/ChatGroupSeat.tsx')
type Props = ComponentProps<typeof GroupMembers>

/** A node store the test edits in place, notifying each key's subscribers like the Chat builder. */
const fakeStore = (initial: Record<string, ChatConversationViewNode>) => {
  const nodes = new Map(Object.entries(initial))
  const listeners = new Map<string, Set<() => void>>()
  const store = {
    get: (key: string) => nodes.get(key),
    source: (key: string) => ({
      getSnapshot: () => nodes.get(key),
      subscribe: (listener: () => void) => {
        const set = listeners.get(key) ?? new Set()
        set.add(listener)
        listeners.set(key, set)
        return () => {
          set.delete(listener)
        }
      },
    }),
  }
  const set = (key: string, node: ChatConversationViewNode): void => {
    nodes.set(key, node)
    for (const listener of listeners.get(key) ?? []) listener()
  }
  // SAFETY: GroupMembers reads only `get` and `source` of the store.
  return { store: store as unknown as ChatNodeStore, set }
}

// SAFETY: subagent detection reads only `kind` and `data.root`.
const node = (root: unknown): ChatConversationViewNode => ({ kind: 'tool-call', data: { root } }) as unknown as ChatConversationViewNode
const calling = (name = 'subagent') => node({ phase: 'start', name })
const started = (child: string) =>
  node({ kind: 'tool-result', name: 'subagent', call: { name: 'subagent' }, isError: false, content: [{ type: 'text', text: `started subagent ${child}` }] })

const t = ((key: string, params?: { count?: number }) => {
  if (key === 'message.turnProcess.subagents.other') return `${String(params?.count)} subagents`
  if (key === 'message.subagentRun.working') return `${String(params?.count)} working`
  if (key === 'message.turnProcess.separator') return ' · '
  return key
}) as Props['t']

/** Hides the body the way the flow's group action does, without the viewport motion. */
function useGroupAction(hidden: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  if (ref.current !== null) ref.current.hidden = hidden
  return ref
}

// SAFETY: the run block reads only `key` of each member reference.
const members = (keys: readonly string[]): readonly NodeReference[] => keys.map(key => ({ kind: 'node', key }) as unknown as NodeReference)

const renderMembers = (input: { store: ChatNodeStore; keys: readonly string[]; running: ReadonlySet<string> }) => {
  // SAFETY: the run block and its rows (stubbed) read only these props.
  const props = {
    nodeStore: input.store,
    members: members(input.keys),
    t,
    useGroupAction,
    useSessionStatus: (selector: (statuses: ReadonlyMap<string, { running: boolean }>) => unknown) =>
      selector(new Map([...input.running].map(id => [id, { running: true }]))),
  } as unknown as Props
  return render(<GroupMembers {...props} />)
}

afterEach(cleanup)

describe('subagent run block', () => {
  it('folds consecutive delegations under one count header and leaves other rows alone', () => {
    const { store } = fakeStore({
      read: node({ phase: 'start', name: 'read' }),
      a: started('child-a'),
      b: started('child-b'),
      c: calling(),
      bash: node({ phase: 'start', name: 'bash' }),
    })
    renderMembers({ store, keys: ['read', 'a', 'b', 'c', 'bash'], running: new Set(['child-a']) })
    const header = screen.getByRole('button', { name: '3 subagents · 2 working' })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByTestId('row').map(row => row.textContent)).toEqual(['read', 'a', 'b', 'c', 'bash'])
    const block = header.closest('[data-subagent-run]')
    expect(block?.querySelectorAll('[data-testid="row"]')).toHaveLength(3)
  })

  it('opens while any works, folds when all finish, and keeps the reader toggle', () => {
    const { store } = fakeStore({ a: started('child-a'), b: started('child-b') })
    const { rerender } = renderMembers({ store, keys: ['a', 'b'], running: new Set(['child-a']) })
    expect(screen.getByRole('button', { name: '2 subagents · 1 working' }).getAttribute('aria-expanded')).toBe('true')
    // SAFETY: rerender keeps every prop but the status map.
    const again = (running: ReadonlySet<string>) =>
      rerender(
        <GroupMembers
          {...({
            nodeStore: store,
            members: members(['a', 'b']),
            t,
            useGroupAction,
            useSessionStatus: (selector: (statuses: ReadonlyMap<string, { running: boolean }>) => unknown) =>
              selector(new Map([...running].map(id => [id, { running: true }]))),
          } as unknown as Props)}
        />,
      )
    again(new Set())
    const header = screen.getByRole('button', { name: '2 subagents' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    again(new Set(['child-b']))
    fireEvent.click(screen.getByRole('button', { name: '2 subagents · 1 working' }))
    expect(screen.getByRole('button', { name: '2 subagents · 1 working' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('forms the block once a second delegation arrives, and keeps a lone one a plain row', () => {
    const fake = fakeStore({ a: calling(), x: node({ phase: 'start', name: '' }) })
    renderMembers({ store: fake.store, keys: ['a', 'x'], running: new Set() })
    expect(screen.queryByRole('button')).toBeNull()
    // A streamed call learns its name after it starts; the run forms from that update alone.
    act(() => {
      fake.set('x', calling('subagent_fork'))
    })
    expect(screen.getByRole('button', { name: '2 subagents · 2 working' })).not.toBeNull()
  })
})
