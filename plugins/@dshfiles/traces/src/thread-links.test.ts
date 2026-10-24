import { ChatFocusModel } from '@dshfiles/chat/chat-focus'
import { describe, expect, test } from 'vitest'
import { ThreadLinks } from './thread-links.js'
import type { AttributeValue } from './types.js'

const span = (spanId: string, parentSpanId: string | null, attributes: Record<string, AttributeValue>, sessionId: string | null = null) => ({
  spanId,
  parentSpanId,
  sessionId,
  attributes,
})

/** One turn whose tool call ran a plugin span, and a subagent turn nested under the delegation tool. */
const spans = [
  span('entry', null, { 'dsh.session.id': 'parent', 'dsh.turn': 4 }, 'parent'),
  span('step', 'entry', { 'dsh.session.id': 'parent', 'dsh.turn': 4, 'dsh.step': 2 }, 'parent'),
  span('tool', 'step', { 'dsh.session.id': 'parent', 'dsh.turn': 4, 'dsh.step': 2, 'gen_ai.tool.call.id': 'call-7' }, 'parent'),
  span('plugin', 'tool', { 'dshx.api': 'jujutsu' }),
  span('child-turn', 'tool', { 'dsh.session.id': 'child', 'dsh.turn': 1 }, 'child'),
  span('child-chat', 'child-turn', { 'dsh.session.id': 'child', 'dsh.turn': 1, 'dsh.step': 1 }, 'child'),
  span('dispatch', null, { 'dsh.session.id': 'parent' }, 'parent'),
  span('foreign', null, {}),
]

describe('threadTargetOf', () => {
  test('lands a tool span, and a plugin span under it, on the tool call', () => {
    const toolCall = { sessionId: 'parent', focus: { turn: 4, step: 2, toolCallId: 'call-7' } }
    expect(ThreadLinks.targetOf(spans, 'tool')).toEqual(toolCall)
    expect(ThreadLinks.targetOf(spans, 'plugin')).toEqual(toolCall)
  })

  test('lands a step or turn span on its step or turn, and a subagent span in its own thread', () => {
    expect(ThreadLinks.targetOf(spans, 'step')).toEqual({ sessionId: 'parent', focus: { turn: 4, step: 2 } })
    expect(ThreadLinks.targetOf(spans, 'entry')).toEqual({ sessionId: 'parent', focus: { turn: 4 } })
    expect(ThreadLinks.targetOf(spans, 'child-chat')).toEqual({ sessionId: 'child', focus: { turn: 1, step: 1 } })
  })

  test('opens a session without a turn unfocused, and nothing for a span of no thread', () => {
    expect(ThreadLinks.targetOf(spans, 'dispatch')).toEqual({ sessionId: 'parent', focus: null })
    expect(ThreadLinks.targetOf(spans, 'foreign')).toBeNull()
    expect(ThreadLinks.targetOf(spans, 'missing')).toBeNull()
  })

  test('survives a parent cycle', () => {
    expect(ThreadLinks.targetOf([span('a', 'b', {}, 's'), span('b', 'a', {})], 'a')).toEqual({ sessionId: 's', focus: null })
  })
})

describe('view focus encodings', () => {
  test('round-trip the Traces and Chat focus and refuse each other', () => {
    expect(ThreadLinks.decodeFocus(ThreadLinks.encodeFocus({ turn: 3 }))).toEqual({ turn: 3 })
    expect(ThreadLinks.decodeFocus(ChatFocusModel.encode({ turn: 3 }))).toBeNull()
    expect(ChatFocusModel.decode(ThreadLinks.encodeFocus({ turn: 3 }))).toBeNull()
    expect(ThreadLinks.decodeFocus('dshfiles-traces-focus:{"turn":"3"}')).toBeNull()
  })
})
