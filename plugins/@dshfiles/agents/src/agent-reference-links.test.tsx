// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { beforeEach, describe, expect, it } from 'vitest'

import { agentReferencePreviewEvent, agentReferencePreviewRequestSchema } from './agent-reference.js'
import { installAgentReferenceLinks } from './agent-reference-links.js'

const handles = new Set(['luna', 'dsh'])

const links = (): readonly string[] => [...document.querySelectorAll('[data-dshfiles-agent-reference]')].map(element => element.textContent ?? '')

describe('agent reference links', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('links a known mention in a sent message and in a compact Markdown comment', () => {
    document.body.innerHTML = [
      '<div data-conversation-session="s"><p>Ask @luna to fix b:1.</p></div>',
      '<div data-markdown-variant="compact"><p>Ask @dsh too.</p></div>',
    ].join('')
    const stop = installAgentReferenceLinks({ handles: () => handles })

    expect(links()).toEqual(['@luna', '@dsh'])
    const first = document.querySelector('[data-dshfiles-agent-reference="luna"]')
    expect(first?.getAttribute('role')).toBe('link')
    expect(first?.getAttribute('aria-label')).toBe('Preview agent @luna')
    stop()
  })

  it('leaves an unknown handle, a scope and a code example alone', () => {
    document.body.innerHTML = [
      '<div data-conversation-session="s">',
      '<p>@nobody and @agent:luna and luna@dsh.dev stay text</p>',
      '<pre><code>@luna</code></pre>',
      '<div data-dshfiles-agent-preview><p>@luna</p></div>',
      '</div>',
    ].join('')
    const stop = installAgentReferenceLinks({ handles: () => handles })

    expect(links()).toEqual([])
    stop()
  })

  it('asks for a preview when one of those links is clicked', () => {
    document.body.innerHTML = '<div data-conversation-session="s"><p>Working with @luna.</p></div>'
    const requests: { readonly handle: string; readonly anchorId: number }[] = []
    const onRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = agentReferencePreviewRequestSchema.safeParse(event.detail)
      if (parsed.success) requests.push(parsed.data)
    }
    window.addEventListener(agentReferencePreviewEvent, onRequest)
    const stop = installAgentReferenceLinks({ handles: () => handles })

    const link = document.querySelector('[data-dshfiles-agent-reference]')
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))

    expect(requests).toHaveLength(1)
    expect(requests[0]?.handle).toBe('luna')
    // The request carries the anchor the card re-measures when the page scrolls.
    expect(document.querySelector(`[data-dshfiles-agent-preview-anchor="${String(requests[0]?.anchorId)}"]`)).toBe(link)
    window.removeEventListener(agentReferencePreviewEvent, onRequest)
    stop()
  })

  it('opens the card from the keyboard and ignores a right click or a text selection', () => {
    document.body.innerHTML = '<div data-conversation-session="s"><p>Working with @luna.</p></div>'
    const handlesSeen: string[] = []
    const onRequest = (event: Event): void => {
      if (event instanceof CustomEvent) handlesSeen.push(String((event.detail as { handle: unknown }).handle))
    }
    window.addEventListener(agentReferencePreviewEvent, onRequest)
    const stop = installAgentReferenceLinks({ handles: () => handles })

    const link = document.querySelector('[data-dshfiles-agent-reference]')
    link?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 }))

    expect(handlesSeen).toEqual(['luna'])
    window.removeEventListener(agentReferencePreviewEvent, onRequest)
    stop()
  })

  it('opens the card from the native mention chip a sent message renders', () => {
    document.body.innerHTML = [
      '<div data-conversation-session="s">',
      '<button type="button" data-ref-chip="file" title="@luna">luna</button>',
      '<button type="button" data-ref-chip="file" title="@nobody">nobody</button>',
      '<div data-composer-card><button type="button" data-ref-chip="file" title="@dsh">dsh</button></div>',
      '</div>',
    ].join('')
    const handlesSeen: string[] = []
    const onRequest = (event: Event): void => {
      if (event instanceof CustomEvent) handlesSeen.push(String((event.detail as { handle: unknown }).handle))
    }
    window.addEventListener(agentReferencePreviewEvent, onRequest)
    const stop = installAgentReferenceLinks({ handles: () => handles })
    const chip = document.querySelector('[data-ref-chip][title="@luna"]')

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    chip?.dispatchEvent(click)
    document.querySelector('[data-ref-chip][title="@nobody"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    document.querySelector('[data-composer-card] [data-ref-chip]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))

    expect(handlesSeen).toEqual(['luna'])
    // The chip is the conversation's own button; the card replaces its inert default.
    expect(click.defaultPrevented).toBe(true)
    window.removeEventListener(agentReferencePreviewEvent, onRequest)
    stop()
  })
})
