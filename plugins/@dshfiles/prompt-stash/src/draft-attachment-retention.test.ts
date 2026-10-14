import { describe, expect, it } from 'vitest'
import { createDraftAttachmentKeeper } from './draft-attachment-retention.js'

const trackedKeeper = () => {
  const held = new Map<string, number>()
  const keeper = createDraftAttachmentKeeper<string>({
    retain: sessionId => {
      held.set(sessionId, (held.get(sessionId) ?? 0) + 1)
      return () => held.set(sessionId, (held.get(sessionId) ?? 0) - 1)
    },
  })
  return { keeper, references: (sessionId: string) => held.get(sessionId) ?? 0 }
}

describe('draft attachment retention', () => {
  it('holds a thread once its composer has attachments and keeps holding after the composer unmounts', () => {
    const { keeper, references } = trackedKeeper()
    keeper.report('thread-a', 0)
    expect(references('thread-a')).toBe(0)
    keeper.report('thread-a', 2)
    keeper.report('thread-a', 3)
    expect(references('thread-a')).toBe(1)
    keeper.report('thread-b', 1)
    expect(references('thread-a')).toBe(1)
    expect(references('thread-b')).toBe(1)
  })

  it('lets the thread go once its attachments are sent or removed, and holds it again for new ones', () => {
    const { keeper, references } = trackedKeeper()
    keeper.report('thread-a', 2)
    keeper.report('thread-a', 0)
    expect(references('thread-a')).toBe(0)
    keeper.report('thread-a', 1)
    expect(references('thread-a')).toBe(1)
  })

  it('releases every held thread when the plugin unloads', () => {
    const { keeper, references } = trackedKeeper()
    keeper.report('thread-a', 1)
    keeper.report('thread-b', 4)
    keeper.dispose()
    expect(references('thread-a')).toBe(0)
    expect(references('thread-b')).toBe(0)
  })
})
