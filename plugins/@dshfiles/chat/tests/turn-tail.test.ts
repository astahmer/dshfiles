import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch, ConversationStartMatch, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { turnTailDefinition } from '../src/native/conversation-nodes/turn-tail.ts'

const makeContext = () => {
  const turn: TurnLocation = {
    turn: 1,
    start: undefined,
    end: undefined,
    status: 'open',
    steps: [],
    data: {
      get: () => undefined,
      source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
    },
  }
  const start: ConversationStartMatch = {
    role: 'start',
    location: { kind: 'turn', turn },
    event: { type: 'turn/start', seq: SessionSeq(10), time: 1000, data: { turn: 1 } },
  }
  const context: Parameters<NonNullable<typeof turnTailDefinition.buildLocationData>>[0] = {
    key: 'turn-tail:1',
    kind: 'turn-tail',
    id: '1',
    start,
    matches: [start],
    state: { turn: 1 },
    current: new Map(),
  }
  return { context, start }
}

const tailData = (context: Parameters<NonNullable<typeof turnTailDefinition.buildLocationData>>[0]) =>
  turnTailDefinition.buildLocationData?.(context, 'turn', null)

describe('turnTailDefinition', () => {
  it('publishes a live tail immediately at turn start without assistant actions', () => {
    const { context, start } = makeContext()
    expect(turnTailDefinition.match(start.event)).toEqual({ id: '1', role: 'start' })
    expect(turnTailDefinition.publication?.(start)).toBe('immediate')
    expect(tailData(context)).toEqual({
      kind: 'turn',
      turn: 1,
      key: 'turn-tail',
      value: { turn: 1, seq: 10, time: start.event.time, closing: null, branchUnavailable: true },
    })
  })

  it('moves the live tail after matched content while retaining the turn start time', () => {
    const { context, start } = makeContext()
    const update: ConversationMatch = {
      role: 'update',
      location: start.location,
      event: { type: 'step/start', seq: SessionSeq(25), time: 2000, data: { turn: 1, step: 1 } },
    }
    expect(turnTailDefinition.publication?.(update)).toBe('animation-frame')
    expect(tailData({ ...context, matches: [start, update] })?.value).toEqual({
      turn: 1,
      seq: 25,
      time: start.event.time,
      closing: null,
      branchUnavailable: true,
    })
  })

  it('does not invent an active tail from a partial history without a start', () => {
    const { context } = makeContext()
    expect(tailData({ ...context, start: undefined, state: undefined })).toBeNull()
  })

  it('retains completed tail sequence and time once the turn ends', () => {
    const { context, start } = makeContext()
    const end: ConversationMatch = {
      role: 'update',
      location: start.location,
      event: { type: 'turn/end', seq: SessionSeq(30), time: 3000, data: { turn: 1, reason: { kind: 'completed' } } },
    }
    expect(turnTailDefinition.publication?.(end)).toBe('immediate')
    const state = turnTailDefinition.update({ ...context, state: { turn: 1 } }, end)
    expect(tailData({ ...context, state, matches: [start, end] })?.value).toMatchObject({
      turn: 1,
      seq: 30,
      time: end.event.time,
      closing: null,
    })
  })
})
