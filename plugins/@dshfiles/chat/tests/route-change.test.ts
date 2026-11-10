import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ConversationStartMatch, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { routeChangeDefinition, routeChangeParts, type ChatRoute } from '../src/native/conversation-nodes/route-change.ts'

type RouteContext = Parameters<NonNullable<typeof routeChangeDefinition.buildViewNode>>[0]

const turn: TurnLocation = {
  turn: 2,
  start: undefined,
  end: undefined,
  status: 'closed',
  steps: [],
  data: {
    get: () => undefined,
    source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
  },
}

/** Build the node one `request/header` yields after a header with `previous` as its route. */
const headerNode = (input: {
  readonly seq: number
  readonly config: { provider: string; model: string; reasoningEffort?: string }
  readonly previous: ChatRoute | undefined
}) => {
  const start: ConversationStartMatch = {
    role: 'start',
    location: { kind: 'turn', turn },
    event: {
      type: 'request/header',
      seq: SessionSeq(input.seq),
      time: input.seq,
      data: {
        header: {
          config:
            input.config.reasoningEffort === undefined
              ? { provider: input.config.provider, model: input.config.model }
              : { provider: input.config.provider, model: input.config.model, reasoningEffort: ReasoningEffortId(input.config.reasoningEffort) },
        },
        reason: 'change',
      },
    },
  }
  const pending: RouteContext = {
    key: `route-change:${String(input.seq)}`,
    kind: 'route-change',
    id: String(input.seq),
    start,
    matches: [start],
    state: undefined,
    current: new Map(),
  }
  const reader = { previous: () => (input.previous === undefined ? undefined : { state: { route: input.previous, previous: undefined } }) }
  // SAFETY: the Definition reads only `state.route` of its predecessor, which this reader provides.
  const state = routeChangeDefinition.start(pending, start, reader as Parameters<typeof routeChangeDefinition.start>[2])
  return routeChangeDefinition.buildViewNode?.({ ...pending, state }) ?? null
}

describe('route-change markers', () => {
  it('marks a request whose model or effort differs from the request before it', () => {
    const node = headerNode({
      seq: 40,
      config: { provider: 'codex-main', model: 'gpt-6', reasoningEffort: 'low' },
      previous: { provider: 'claude-main', model: 'claude-opus-5', effort: 'high' },
    })
    expect(node).toMatchObject({
      kind: 'route-change',
      anchorSeq: 40,
      groupTree: 'turn',
      data: { from: { model: 'claude-opus-5', effort: 'high' }, to: { provider: 'codex-main', model: 'gpt-6', effort: 'low' } },
    })
  })

  it('stays silent for the first header and for a header that changed only its tools', () => {
    expect(headerNode({ seq: 3, config: { provider: 'a', model: 'm' }, previous: undefined })).toBeNull()
    expect(headerNode({ seq: 9, config: { provider: 'a', model: 'm' }, previous: { provider: 'a', model: 'm' } })).toBeNull()
  })

  it('names the model change, else the account change, then the effort change', () => {
    expect(routeChangeParts({ provider: 'a', model: 'm1', effort: 'high' }, { provider: 'b', model: 'm2' })).toEqual([
      { field: 'model', from: 'm1', to: 'm2' },
      { field: 'effort', from: 'high', to: 'default' },
    ])
    expect(routeChangeParts({ provider: 'a', model: 'm' }, { provider: 'b', model: 'm' })).toEqual([{ field: 'provider', from: 'a', to: 'b' }])
    expect(routeChangeParts({ provider: 'a', model: 'm' }, { provider: 'a', model: 'm' })).toEqual([])
  })
})
