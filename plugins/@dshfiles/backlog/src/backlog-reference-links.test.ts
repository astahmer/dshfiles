// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { backlogReferencePreviewEvent, backlogReferencePreviewRequestSchema } from './backlog-reference.js'
import { installBacklogReferenceLinks } from './backlog-reference-links.js'

const links = (): readonly string[] => [...document.querySelectorAll('[data-dshfiles-backlog-reference]')].map(element => element.textContent ?? '')

describe('backlog reference links', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('links an item number in prose and in inline code', () => {
    document.body.innerHTML = '<div data-conversation-session="s"><p>Next: b:12, then <code>b:13</code>.</p></div>'
    const stop = installBacklogReferenceLinks()

    expect(links()).toEqual(['b:12', 'b:13'])
    const first = document.querySelector('[data-dshfiles-backlog-reference="12"]')
    expect(first?.getAttribute('role')).toBe('link')
    expect(first?.getAttribute('aria-label')).toBe('Preview backlog item b:12')
    stop()
  })

  it('leaves code examples, words that only contain a token and references in another page alone', () => {
    document.body.innerHTML = [
      '<div data-conversation-session="s">',
      '<pre><code>b:12</code></pre>',
      '<p>a/b:12 and rb:12 stay text</p>',
      '<div data-dshfiles-backlog-preview><p>b:12</p></div>',
      '</div>',
    ].join('')
    const stop = installBacklogReferenceLinks()

    expect(links()).toEqual([])
    stop()
  })

  it('asks for a preview when one of those links is clicked', () => {
    document.body.innerHTML = '<div data-conversation-session="s"><p>Working on b:12.</p></div>'
    const requests: { readonly id: number; readonly anchorId: number }[] = []
    const onRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = backlogReferencePreviewRequestSchema.safeParse(event.detail)
      if (parsed.success) requests.push(parsed.data)
    }
    window.addEventListener(backlogReferencePreviewEvent, onRequest)
    const stop = installBacklogReferenceLinks()

    const link = document.querySelector('[data-dshfiles-backlog-reference]')
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))

    expect(requests).toHaveLength(1)
    expect(requests[0]?.id).toBe(12)
    // The request carries the anchor the card re-measures when the page scrolls.
    expect(document.querySelector(`[data-dshfiles-backlog-preview-anchor="${String(requests[0]?.anchorId)}"]`)).toBe(link)
    window.removeEventListener(backlogReferencePreviewEvent, onRequest)
    stop()
  })

  it('does not open a preview when the click extends a text selection', () => {
    document.body.innerHTML = '<div data-conversation-session="s"><p>Working on b:12.</p></div>'
    const requests: unknown[] = []
    const onRequest = (event: Event): void => {
      if (event instanceof CustomEvent) requests.push(event.detail)
    }
    window.addEventListener(backlogReferencePreviewEvent, onRequest)
    const stop = installBacklogReferenceLinks()

    document.body.append(document.createTextNode('selectable'))
    document.getSelection()?.selectAllChildren(document.body)
    document.querySelector('[data-dshfiles-backlog-reference]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))

    expect(requests).toEqual([])
    window.removeEventListener(backlogReferencePreviewEvent, onRequest)
    stop()
  })

  it('rescans only the block whose text changed', async () => {
    const messages = Array.from({ length: 200 }, (_unused, index) => `<p>message ${String(index)}: b:${String(index + 1)}</p>`).join('')
    document.body.innerHTML = `<div data-conversation-session="s">${messages}</div>`
    const stop = installBacklogReferenceLinks()
    const changed = document.querySelectorAll('p')[0]
    if (changed === undefined) throw new Error('fixture blocks are missing')
    expect(links()).toHaveLength(200)

    // Every rescan walks a block's text, so the walker roots are exactly the work this installer did.
    const walker = vi.spyOn(document, 'createTreeWalker')
    changed.textContent = 'only b:1 remains'
    await new Promise(resolve => setTimeout(resolve, 60))

    const rescanned = new Set(walker.mock.calls.map(call => call[0]))
    expect([...rescanned]).toEqual([changed])
    expect(links()).toHaveLength(200)
    walker.mockRestore()
    stop()
  })
})
