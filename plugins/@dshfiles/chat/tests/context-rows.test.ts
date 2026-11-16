import { describe, expect, it } from 'vitest'
import { isRoutineContext, isRoutineContextNode, showsRoutineContext } from '../src/native/chat/context-rows.ts'
import type { ChatNode } from '../src/native/contract/chat-nodes.ts'
import type { ChatLocationNodeIndex, ChatNodeStore } from '../src/native/contract/snapshot.ts'
import { ChatTurnProcessProjector } from '../src/native/conversation-nodes/turn-process-presentation.ts'

type ContextData = Parameters<typeof isRoutineContext>[0]

const injected = (label: string): ContextData => ({ content: [{ type: 'text', text: label }], producer: { role: 'inject', label } })

describe('routine context rows', () => {
  it('treats what the Host injects on its own as plumbing', () => {
    for (const label of ['runtime-context', 'skill-catalog', 'time-context']) expect(isRoutineContext(injected(label))).toBe(true)
  })

  it('keeps a recalled thread and a tool-list change as rows', () => {
    expect(isRoutineContext({ content: [{ type: 'text', text: 'earlier thread' }], producer: { role: 'recall', label: 'Fix the cart' } })).toBe(false)
    // SAFETY: only the block type is read.
    const toolChange = [{ type: 'tool-addition', toolName: 'web_search' }] as unknown as ContextData['content']
    expect(isRoutineContext({ content: toolChange, producer: { role: 'inject', label: null } })).toBe(false)
  })

  it('shows them only in the Verbose view mode', () => {
    expect(['compact', 'standard', 'detailed', 'verbose'].filter(showsRoutineContext)).toEqual(['verbose'])
  })
})

/** One closed Turn: its process control, then the given process rows. */
const projectTurn = (rows: readonly Pick<ChatNode, 'kind' | 'data'>[]) => {
  const turn = { turn: 1, status: 'closed', start: { seq: 1, time: 0 } }
  const location = { kind: 'turn', turn }
  const control = {
    key: 'control',
    kind: 'turn-process',
    visibility: 'visible',
    anchorSeq: 2,
    groupTree: 'turn',
    location,
    data: { turn: 1, controlAnchorSeq: 2, processStartSeq: 2, answerAnchorSeq: null, answerStep: null },
  }
  const members = rows.map((row, index) => ({ ...row, key: `row-${index}`, visibility: 'visible', anchorSeq: 3 + index, location }))
  const byKey = new Map<string, unknown>([control, ...members].map(node => [node.key, node]))
  // SAFETY: the projector reads only `get` and `getTurn`, and of each Node only the fields built above.
  const nodes = { get: (key: string) => byKey.get(key) } as unknown as ChatNodeStore
  const locations = { getTurn: () => [...byKey.keys()], getStep: () => [] } satisfies ChatLocationNodeIndex
  const projector = new ChatTurnProcessProjector()
  projector.update(new Set([1]), locations, nodes)
  // SAFETY: the store holds the control built above; the projector reads only its Turn location.
  return projector.get(nodes.get('control') as ChatNode | undefined)
}

describe('a Turn whose process is only routine context', () => {
  const context = { kind: 'context', data: injected('runtime-context') } as Pick<ChatNode, 'kind' | 'data'>
  // SAFETY: the projector reads only the kind of a tool-call row.
  const toolCall = { kind: 'tool-call', data: {} } as unknown as Pick<ChatNode, 'kind' | 'data'>

  it('is marked, so its "Worked for" row has nothing to disclose', () => {
    expect(isRoutineContextNode(context)).toBe(true)
    expect(projectTurn([context, context, context])?.onlyRoutineContext).toBe(true)
  })

  it('is not marked once a tool call joins the context rows', () => {
    const presentation = projectTurn([context, toolCall])
    expect(presentation?.hasNonReplyProcess).toBe(true)
    expect(presentation?.onlyRoutineContext).toBe(false)
  })

  it('is not marked when the Turn has no process rows at all', () => {
    expect(projectTurn([])?.onlyRoutineContext).toBe(false)
  })
})
