import { describe, expect, it } from 'vitest'
import { idleGenerationStart, type IdleBoundaryEvent } from '../src/idle-generation.js'

const event = (type: Exclude<IdleBoundaryEvent['type'], 'user/message'>): IdleBoundaryEvent => ({ type, time: 1_000 })
const userMessage = (kind: Extract<IdleBoundaryEvent, { type: 'user/message' }>['data']['source']['kind']): IdleBoundaryEvent => ({
  type: 'user/message',
  time: 1_000,
  data: { source: { kind } },
})

describe('idleGenerationStart', () => {
  it('arms an idle stretch from a request, a turn end, or a real user message', () => {
    expect(idleGenerationStart(event('request/header'))).toBe(1_000)
    expect(idleGenerationStart(event('turn/end'))).toBe(1_000)
    expect(idleGenerationStart(userMessage('user'))).toBe(1_000)
  })

  it('does not arm another attempt from a compaction checkpoint it wrote itself', () => {
    expect(idleGenerationStart(userMessage('compact-checkpoint'))).toBeNull()
  })

  it('ignores events that do not mark a request or idle boundary', () => {
    expect(idleGenerationStart(event('compaction/summary'))).toBeNull()
    expect(idleGenerationStart(event('assistant/message'))).toBeNull()
  })
})
