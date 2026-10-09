import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInEditor } from './open-in-editor.ts'

describe('openInEditor', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports handled when the editor takes the cancelable request', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const received: string[] = []
    target.addEventListener('dshfiles:open-file', event => {
      if (!(event instanceof CustomEvent) || !event.cancelable) return
      received.push(`${event.detail.cwd}/${event.detail.path}`)
      event.preventDefault()
    })
    expect(openInEditor({ path: 'src/a.ts', cwd: '/repo' })).toBe(true)
    expect(received).toEqual(['/repo/src/a.ts'])
  })

  it('reports unhandled when no editor listens', () => {
    vi.stubGlobal('window', new EventTarget())
    expect(openInEditor({ path: 'src/a.ts', cwd: '/repo' })).toBe(false)
  })
})
