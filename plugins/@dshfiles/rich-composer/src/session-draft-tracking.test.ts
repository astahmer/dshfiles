import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'
import { observeSessionDraft } from './session-draft-tracking.js'

describe('session draft tracking', () => {
  it('publishes restored input immediately and every text edit before send', () => {
    const state = createSnapshotStore<{ draft: string; attachmentIds: string[] }>({ draft: 'restored draft', attachmentIds: [] })
    const update = vi.fn()
    const stop = observeSessionDraft({ state, update })
    expect(update).toHaveBeenLastCalledWith({ text: 'restored draft', hasAttachments: false })
    state.set({ draft: 'another letter', attachmentIds: [] })
    expect(update).toHaveBeenLastCalledWith({ text: 'another letter', hasAttachments: false })
    state.set({ draft: '', attachmentIds: [] })
    expect(update).toHaveBeenLastCalledWith({ text: '', hasAttachments: false })
    stop()
    state.set({ draft: 'no longer retained', attachmentIds: [] })
    expect(update).toHaveBeenCalledTimes(3)
  })

  it('ignores unchanged input and publishes attachment-only drafts', () => {
    const state = createSnapshotStore<{ draft: string; attachmentIds: string[] }>({ draft: '', attachmentIds: [] })
    const update = vi.fn()
    const stop = observeSessionDraft({ state, update })
    state.set({ draft: '', attachmentIds: [] })
    expect(update).toHaveBeenCalledTimes(1)
    state.set({ draft: '', attachmentIds: ['attachment-one'] })
    expect(update).toHaveBeenLastCalledWith({ text: '', hasAttachments: true })
    state.set({ draft: '', attachmentIds: ['attachment-one', 'attachment-two'] })
    expect(update).toHaveBeenCalledTimes(2)
    state.set({ draft: '', attachmentIds: [] })
    expect(update).toHaveBeenLastCalledWith({ text: '', hasAttachments: false })
    stop()
  })
})
