import { afterEach, describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ConversationStartMatch, NodeKey, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ChatNode } from '../src/native/contract/chat-nodes.ts'
import { ProcessState } from '../src/native/conversation-nodes/process-groups.ts'
import { toolDefinition } from '../src/native/conversation-nodes/tool.ts'
import { setPinnedToolNames } from '../src/pinned-tool-names.ts'

type ToolContext = Parameters<NonNullable<typeof toolDefinition.buildViewNode>>[0]
const noPredecessors = { previous: () => undefined }

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

afterEach(() => setPinnedToolNames([]))

describe('pinned tool calls', () => {
  it('keeps every call in one step group while nothing is pinned', () => {
    const nodes = [toolNode({ seq: 11, name: 'bash' }), toolNode({ seq: 12, name: 'html_render' }), toolNode({ seq: 13, name: 'bash' })]
    expect(nodes.map(node => node.groupTree)).toEqual([undefined, undefined, undefined])
    expect(rootEntries(nodes)).toEqual(['group'])
  })

  it('places a pinned call in the Turn outside the process fold and the step groups around it', () => {
    setPinnedToolNames(['html_render'])
    const nodes = [toolNode({ seq: 11, name: 'bash' }), toolNode({ seq: 12, name: 'html_render' }), toolNode({ seq: 13, name: 'bash' })]
    expect(nodes.map(node => node.groupTree)).toEqual([undefined, 'turn', undefined])
    expect(rootEntries(nodes)).toEqual(['group', 'node', 'group'])
  })
})
