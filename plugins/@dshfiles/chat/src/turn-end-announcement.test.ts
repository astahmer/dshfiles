import { describe, expect, it } from 'vitest'
import { en, type ChatKey } from './native/locale.ts'
import { turnEndAnnouncement } from './native/chat/TurnProcessNodeView.tsx'

const t = (key: ChatKey): string => en[key]

describe('what a screen reader hears when a turn ends', () => {
  it('says "Reply ready" for a finished turn, "Turn failed" for a failure and "Stopped" for a stop', () => {
    expect(turnEndAnnouncement('completed', t)).toBe('Reply ready')
    expect(turnEndAnnouncement(undefined, t)).toBe('Reply ready')
    expect(turnEndAnnouncement('error', t)).toBe('Turn failed')
    expect(turnEndAnnouncement('aborted', t)).toBe(en['message.stopped'])
  })
})
