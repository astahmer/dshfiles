import { afterEach, describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ConversationStartMatch, NodeKey, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ChatNode } from '../src/native/contract/chat-nodes.ts'
import { ProcessState } from '../src/native/conversation-nodes/process-groups.ts'
import { toolDefinition } from '../src/native/conversation-nodes/tool.ts'
import type { PinnedToolCall } from '../src/pinned-tool-calls.ts'
import { PinnedToolNames } from '../src/pinned-tool-names.ts'

type ToolContext = Parameters<NonNullable<typeof toolDefinition.buildViewNode>>[0]
const noPredecessors = { previous: () => undefined }

/**
 * The part of uiConversation's event registry Chat relies on: a keyed `register` whose registration and disposal each
 * notify subscribers once, which makes uiConversation rebuild every bound Conversation. The native registry needs the
 * whole client UI module graph to load, so its contract is restated here.
 */
const eventRegistry = () => {
  const definitions = new Map<string, unknown>()
  let refreshes = 0
  return {
    get refreshes() {
      return refreshes
    },
    kinds: () => [...definitions.keys()],
    register: (definition: { readonly kind: string; readonly match: unknown; readonly target?: string }) => {
      if (definitions.has(definition.kind)) throw new Error(`conversation Definition "${definition.kind}" is already registered`)
      expect(definition.match).toEqual({})
      expect(definition.target).toBeUndefined()
      definitions.set(definition.kind, definition)
      refreshes += 1
      return () => {
        if (definitions.delete(definition.kind)) refreshes += 1
      }
    },
  }
}

const turn: TurnLocation = {
  turn: 1,
  start: undefined,
  end: undefined,
  status: 'closed',
  steps: [],
  data: {
    get: () => undefined,
    source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
  },
}

const toolNode = (input: { readonly seq: number; readonly name: string }): ChatNode => {
  const start: ConversationStartMatch = {
    role: 'start',
    location: { kind: 'turn', turn },
    event: {
      type: 'tool/call',
      seq: SessionSeq(input.seq),
      time: input.seq,
      data: { callId: ToolCallId(`call-${String(input.seq)}`), name: input.name, arguments: '{}', turn: 1, step: 1 },
    },
  }
  const pending: ToolContext = {
    key: `tool-call:${String(input.seq)}`,
    kind: 'tool-call',
    id: `call-${String(input.seq)}`,
    start,
    matches: [start],
    state: undefined,
    current: new Map(),
  }
  const context: ToolContext = { ...pending, state: toolDefinition.start(pending, start, noPredecessors) }
  const node = toolDefinition.buildViewNode?.(context) ?? null
  if (node === null) throw new Error('tool node was not built')
  return node as ChatNode
}

/** A call that already returned: its result is an error or not. */
const settledToolNode = (input: { readonly seq: number; readonly name: string; readonly isError: boolean; readonly text?: string }): ChatNode => {
  const start: ConversationStartMatch = {
    role: 'start',
    location: { kind: 'turn', turn },
    event: {
      type: 'tool/call',
      seq: SessionSeq(input.seq),
      time: input.seq,
      data: { callId: ToolCallId(`call-${String(input.seq)}`), name: input.name, arguments: '{}', turn: 1, step: 1 },
    },
  }
  const result: Parameters<typeof toolDefinition.update>[1] = {
    role: 'update',
    location: { kind: 'turn', turn },
    event: {
      type: 'tool/result',
      seq: SessionSeq(input.seq + 1),
      time: input.seq + 1,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId(`call-${String(input.seq)}`),
          content: input.text === undefined ? [] : [{ type: 'text', text: input.text }],
          isError: input.isError,
        }),
      },
    },
  }
  const pending: ToolContext = {
    key: `tool-call:${String(input.seq)}`,
    kind: 'tool-call',
    id: `call-${String(input.seq)}`,
    start,
    matches: [start],
    state: undefined,
    current: new Map(),
  }
  const startedState = toolDefinition.start(pending, start, noPredecessors)
  const settled: ToolContext = { ...pending, state: toolDefinition.update({ ...pending, state: startedState }, result) }
  const node = toolDefinition.buildViewNode?.(settled) ?? null
  if (node === null) throw new Error('tool node was not built')
  // SAFETY: toolDefinition builds 'tool-call' Chat nodes, which is what this helper returns.
  return node as ChatNode
}

const rootEntries = (nodes: readonly ChatNode[]) => {
  const keys = nodes.map(node => brandString<NodeKey>(node.key))
  const byKey = new Map(nodes.map((node, index) => [keys[index], node]))
  const state = new ProcessState()
  state.accept({
    kind: 'replace',
    order: keys,
    readNode: key => byKey.get(key),
    readTurn: () => keys,
    readPosition: key => {
      const index = keys.indexOf(key)
      return index < 0 ? undefined : { turn: 1, previous: keys[index - 1], next: keys[index + 1] }
    },
    timeline: { turnOrder: [1], turns: new Map([[1, turn]]) },
  })
  return state.output()?.entries?.map(entry => entry.kind) ?? []
}

afterEach(() => PinnedToolNames.set([]))

describe('pinned tool calls', () => {
  it('keeps every call in one step group while nothing is pinned', () => {
    const nodes = [toolNode({ seq: 11, name: 'bash' }), toolNode({ seq: 12, name: 'html_render' }), toolNode({ seq: 13, name: 'bash' })]
    expect(nodes.map(node => node.groupTree)).toEqual([undefined, undefined, undefined])
    expect(rootEntries(nodes)).toEqual(['group'])
  })

  it('re-groups already built nodes when a provider pins a tool after they were built, and again when it unpins', () => {
    const registry = eventRegistry()
    let providers: readonly PinnedToolCall[] = []
    const listeners = new Set<() => void>()
    const publish = (next: readonly PinnedToolCall[]): void => {
      providers = next
      for (const listener of listeners) listener()
    }
    const stop = PinnedToolNames.follow({
      providers: {
        get: () => providers,
        subscribe: listener => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      events: registry,
    })
    const built = () => [toolNode({ seq: 11, name: 'bash' }), toolNode({ seq: 12, name: 'html_render' })].map(node => node.groupTree)

    expect(built()).toEqual([undefined, undefined])
    expect(registry.refreshes).toBe(0)
    publish([{ toolName: 'html_render' }])
    expect(registry.refreshes).toBe(1)
    expect(built()).toEqual([undefined, 'turn'])

    publish([{ toolName: 'html_render' }])
    expect(registry.refreshes).toBe(1)

    publish([])
    expect(registry.refreshes).toBe(2)
    expect(built()).toEqual([undefined, undefined])
    expect(registry.kinds()).toEqual([])

    publish([{ toolName: 'html_preview' }])
    expect(registry.kinds()).toEqual(['dshfiles-chat.pinned-tool-calls'])
    stop()
    expect(registry.refreshes).toBe(4)
    expect(registry.kinds()).toEqual([])
    publish([{ toolName: 'html_render' }])
    expect(registry.refreshes).toBe(4)
  })

  it('never folds a question or a failed call: both stay in the Turn outside the process fold', () => {
    const failed = settledToolNode({ seq: 13, name: 'bash', isError: true })
    const passed = settledToolNode({ seq: 14, name: 'bash', isError: false })
    const nodes = [toolNode({ seq: 11, name: 'bash' }), toolNode({ seq: 12, name: 'ask_user_question' }), failed, passed]
    expect(nodes.map(node => node.groupTree)).toEqual([undefined, 'turn', 'turn', undefined])
    expect(rootEntries(nodes)).toEqual(['group', 'node', 'node', 'group'])
  })

  it('treats a shell command that exited non-zero as failed, and exit 0 as folded work', () => {
    const exited = settledToolNode({ seq: 21, name: 'bash', isError: false, text: 'missing fixture\n[exit code: 3]' })
    const ok = settledToolNode({ seq: 23, name: 'bash', isError: false, text: 'step 1\n[exit code: 0]' })
    expect([exited.groupTree, ok.groupTree]).toEqual(['turn', undefined])
  })

  it('places a pinned call in the Turn outside the process fold and the step groups around it', () => {
    PinnedToolNames.set(['html_render'])
    const nodes = [toolNode({ seq: 11, name: 'bash' }), toolNode({ seq: 12, name: 'html_render' }), toolNode({ seq: 13, name: 'bash' })]
    expect(nodes.map(node => node.groupTree)).toEqual([undefined, 'turn', undefined])
    expect(rootEntries(nodes)).toEqual(['group', 'node', 'group'])
  })
})
