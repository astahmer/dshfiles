import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationTarget } from '../schema.js'
import { annotationsUi } from './state.js'

const point = { x: 1, y: 2 }
const target: AnnotationTarget = { surface: 'dsh', url: '', selector: 'div', tag: 'div', rect: { x: 0, y: 0, width: 1, height: 1 } }

afterEach(() => {
  annotationsUi.release('reply')
  annotationsUi.release('capture')
})

describe('annotationsUi', () => {
  it('stores the note in the scope the pick started from', () => {
    annotationsUi.beginPick({ scope: 'backlog:item:7', owner: 'reply', mode: 'element' })
    annotationsUi.picked({ target, point, mode: 'element' })
    expect(annotationsUi.snapshot()).toMatchObject({ scope: 'backlog:item:7', owner: 'reply', pickMode: false, picked: { point } })
  })

  it('lets a composer that unmounts keep its hands off another composer’s pick', () => {
    annotationsUi.beginPick({ scope: 'backlog:item:7', owner: 'reply', mode: 'region' })
    annotationsUi.release('capture')
    expect(annotationsUi.snapshot()).toMatchObject({ owner: 'reply', pickMode: true, mode: 'region' })
    annotationsUi.release('reply')
    expect(annotationsUi.snapshot()).toMatchObject({ scope: null, owner: null, pickMode: false, picked: null })
  })

  it('adopts a pick that finished in the picker browser', () => {
    annotationsUi.pickedFrom({ scope: 'session-1', owner: 'capture', picked: { target, point, mode: 'element' } })
    expect(annotationsUi.snapshot()).toMatchObject({ scope: 'session-1', owner: 'capture', pickMode: false, picked: { point } })
  })

  it('inserts through the writer its composer registered last', () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    annotationsUi.registerDraftWriter({ owner: 'reply', insertText: first })
    annotationsUi.registerDraftWriter({ owner: 'reply', insertText: second })

    expect(annotationsUi.insertIntoDraft({ owner: 'reply', text: 'block' })).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('block')
  })

  it('forgets the writer when its action leaves', () => {
    annotationsUi.registerDraftWriter({ owner: 'reply', insertText: () => true })

    annotationsUi.release('reply')

    expect(annotationsUi.insertIntoDraft({ owner: 'reply', text: 'block' })).toBe(false)
  })
})
