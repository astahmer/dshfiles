// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryReferencePreviewEvent } from './memory-reference.ts'
import { installMemoryReferenceLinks } from './memory-reference-links.ts'

const links = (): readonly string[] => [...document.querySelectorAll('[data-dshfiles-memory-reference]')].map(element => element.textContent ?? '')

describe('memory reference links', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('makes the whole citation the link, and only the id for a backticked reference', async () => {
    document.body.innerHTML =
      // A backticked id renders as its own <code> element, so that citation cannot reach back over `memory:`.
      '<div data-conversation-session="s"><p>Earlier: Memory: t:9356abc7, n:3 and memory: <code>n:7</code>.</p></div>'
    const stop = installMemoryReferenceLinks()

    expect(links()).toEqual(['Memory: t:9356abc7', 'n:3', 'n:7'])

    stop()
    document.body.insertAdjacentHTML('beforeend', '<p>memory: n:9</p>')
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(links()).toEqual(['Memory: t:9356abc7', 'n:3', 'n:7'])
  })

  it('asks for a preview when one of those links is clicked', () => {
    document.body.innerHTML = '<div data-conversation-session="s"><p>Memory: t:9356abc7.</p></div>'
    const requests: { readonly id: string; readonly anchorId: number }[] = []
    const onRequest = (event: Event): void => void requests.push((event as CustomEvent<{ id: string; anchorId: number }>).detail)
    window.addEventListener(memoryReferencePreviewEvent, onRequest)
    const stop = installMemoryReferenceLinks()

    document.querySelector('[data-dshfiles-memory-reference]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))

    expect(requests).toHaveLength(1)
    expect(requests[0]?.id).toBe('t:9356abc7')
    // The request carries the anchor the card re-measures when the page scrolls.
    expect(requests[0]?.anchorId).toBeGreaterThan(0)
    expect(document.querySelector(`[data-dshfiles-memory-preview-anchor="${String(requests[0]?.anchorId)}"]`)).not.toBeNull()
    window.removeEventListener(memoryReferencePreviewEvent, onRequest)
    stop()
  })
})
