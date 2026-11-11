import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session'
import { idleGenerationStart } from '../src/idle-generation.js'

const event = (type: SessionEventType, data: Record<string, unknown> = {}) => ({ type, seq: 1, time: 1_000, data }) as SessionEvent

describe('idleGenerationStart', () => {
  it('arms an idle stretch from a request, a turn end, or a real user message', () => {
    expect(idleGenerationStart(event('request/header'))).toBe(1_000)
    expect(idleGenerationStart(event('turn/end'))).toBe(1_000)
    expect(idleGenerationStart(event('user/message', { source: { kind: 'user' } }))).toBe(1_000)
  })

  it('does not arm another attempt from a compaction checkpoint it wrote itself', () => {
    expect(idleGenerationStart(event('user/message', { source: { kind: 'compact-checkpoint' } }))).toBeNull()
  })

  it('ignores events that do not mark a request or idle boundary', () => {
    expect(idleGenerationStart(event('compaction/summary'))).toBeNull()
    expect(idleGenerationStart(event('assistant/message'))).toBeNull()
  })
})
