import { describe, expect, it } from 'vitest'
import { isToolAcknowledgement } from '../src/native/chat/filler-reply.ts'
import { needsTimeDivider, TIME_DIVIDER_GAP_MS } from '../src/native/chat/time-divider.ts'

const at = (day: number, hour: number, minute: number): number => new Date(2026, 10, day, hour, minute).getTime()

describe('time dividers', () => {
  it("marks the thread's first turn, a new day and a quiet gap over 30 minutes", () => {
    expect(needsTimeDivider(undefined, at(9, 14, 0), 1)).toBe(true)
    expect(needsTimeDivider(at(8, 23, 50), at(9, 0, 5), 7)).toBe(true)
    expect(needsTimeDivider(at(9, 14, 0), at(9, 14, 0) + TIME_DIVIDER_GAP_MS + 1, 7)).toBe(true)
  })

  it('stays quiet between turns of one sitting and above a turn whose predecessor is not loaded', () => {
    expect(needsTimeDivider(at(9, 14, 0), at(9, 14, 25), 7)).toBe(false)
    expect(needsTimeDivider(undefined, at(9, 14, 0), 7)).toBe(false)
  })
})

describe('tool acknowledgements', () => {
  const text = (value: string) => ({ kind: 'text', text: value }) as const

  it('recognises a reply that only acknowledges its tools', () => {
    expect(isToolAcknowledgement([text('Tool finished.')])).toBe(true)
    expect(isToolAcknowledgement([text('Tools completed')])).toBe(true)
  })

  it('keeps short real answers', () => {
    expect(isToolAcknowledgement([text('Done.')])).toBe(false)
    expect(isToolAcknowledgement([text('OK.')])).toBe(false)
    expect(isToolAcknowledgement([text('Tool finished. The tests pass.')])).toBe(false)
    expect(isToolAcknowledgement([])).toBe(false)
  })
})
