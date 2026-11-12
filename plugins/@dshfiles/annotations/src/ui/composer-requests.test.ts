import { describe, expect, it, vi } from 'vitest'
import { annotationsRequests, showsAnnotationsButton } from './composer-requests.js'

describe('annotations in the composer bar (b:v9yh)', () => {
  it('keeps no permanent crosshair in the conversation bar while the More menu offers it', () => {
    expect(showsAnnotationsButton({ surface: 'conversation', inMoreMenu: true, count: 0, working: false })).toBe(false)
  })

  it('shows the tool as a count chip while annotations are open, and while it works', () => {
    expect(showsAnnotationsButton({ surface: 'conversation', inMoreMenu: true, count: 2, working: false })).toBe(true)
    expect(showsAnnotationsButton({ surface: 'conversation', inMoreMenu: true, count: 0, working: true })).toBe(true)
  })

  it('keeps the button where no More menu offers it: a pinned bar and every other composer', () => {
    expect(showsAnnotationsButton({ surface: 'conversation', inMoreMenu: false, count: 0, working: false })).toBe(true)
    expect(showsAnnotationsButton({ surface: 'backlog.reply', inMoreMenu: true, count: 0, working: false })).toBe(true)
  })

  it('opens only the tool of the thread it names', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stop = annotationsRequests.on('session-a', first)
    annotationsRequests.on('session-b', second)()
    annotationsRequests.open('session-a')
    annotationsRequests.open('session-b')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    stop()
    annotationsRequests.open('session-a')
    expect(first).toHaveBeenCalledTimes(1)
  })
})
