import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { imageAttachmentSource } from '../src/image-attachment-source.js'

describe('imageAttachmentSource', () => {
  it('offers an image for repeated @ picks and serializes the visible label', async () => {
    const source = imageAttachmentSource({
      imagesFor: () => [{ id: 'draft-image-a', label: 'Image 1' }],
      open: () => true,
    })
    const session = { sessionId: SessionId('session-a') }
    const candidates = await source.candidates(session, {
      query: '', quoted: false, position: 'leading', drilled: false, signal: new AbortController().signal,
    })
    const candidate = candidates[0]
    expect(candidate).toMatchObject({ name: 'Image 1', value: 'draft-image-a' })
    if (candidate === undefined) throw new Error('Expected an image candidate.')

    const first = source.onPick({ candidate, session, position: 'leading', via: 'menu', action: 'pick', span: { start: 0, end: 2, draftRev: 0 } })
    const second = source.onPick({ candidate, session, position: 'leading', via: 'menu', action: 'pick', span: { start: 10, end: 12, draftRev: 1 } })
    expect(first).toEqual(second)
    if (first === undefined || typeof first !== 'object' || !('insert' in first)) throw new Error('Expected an image reference insertion.')
    expect(await source.codec?.serialize(first.insert.ref, new AbortController().signal, first.insert.label)).toBe('[Image 1]')
  })

  it('routes previews to the owning session and does not open stale ids', () => {
    const open = vi.fn((sessionId: string, id: string) => sessionId === 'session-a' && id === 'draft-image-a')
    const source = imageAttachmentSource({
      imagesFor: () => [{ id: 'draft-image-a', label: 'Image 1' }],
      open,
    })
    const session = { sessionId: SessionId('session-a') }
    expect(source.openReference?.(session, { ref: 'draft-image-a' })).toBe(true)
    expect(source.openReference?.(session, { ref: 'stale-image' })).toBe(false)
    expect(open).toHaveBeenNthCalledWith(1, 'session-a', 'draft-image-a')
    expect(open).toHaveBeenNthCalledWith(2, 'session-a', 'stale-image')
  })
})
