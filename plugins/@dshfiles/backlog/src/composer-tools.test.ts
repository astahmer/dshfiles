import { describe, expect, it, vi } from 'vitest'
import { BacklogComposerScope, createComposerToolHold } from './composer-tools.js'

describe('BacklogComposerScope', () => {
  it('shares one scope between the boxes of an item and keeps captures apart', () => {
    expect(BacklogComposerScope.item({ id: 12, surface: 'backlog.reply' })).toEqual({ surface: 'backlog.reply', scope: 'backlog:item:12', scopeLabel: 'item' })
    expect(BacklogComposerScope.item({ id: 12, surface: 'backlog.description' }).scope).toBe('backlog:item:12')
    expect(BacklogComposerScope.capture('feed')).toEqual({ surface: 'backlog.capture', scope: 'backlog:capture:feed', scopeLabel: 'draft' })
  })
})

describe('createComposerToolHold', () => {
  it('reports held until the last hold ends, then gives the draft its focus back once', () => {
    const onReleased = vi.fn()
    const draft = createComposerToolHold(onReleased)
    expect(draft.held()).toBe(false)
    const first = draft.hold()
    const second = draft.hold()
    first()
    first()
    expect(draft.held()).toBe(true)
    expect(onReleased).not.toHaveBeenCalled()
    second()
    expect(draft.held()).toBe(false)
    expect(onReleased).toHaveBeenCalledOnce()
  })
})
