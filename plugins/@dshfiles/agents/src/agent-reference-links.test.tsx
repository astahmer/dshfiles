// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { InlineReferenceModel, type InlineReferenceContext } from '@dshfiles/chat/inline-references'
import { EntityPreview } from '@dshfiles/input-trigger/entity-registry'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentInlineReference } from './agent-inline-reference.js'
import { installAgentMentionChips } from './agent-reference-links.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const handles = new Set(['luna', 'dsh'])
const prose: InlineReferenceContext = { sessionId: 's', cwd: undefined, surface: 'prose', before: '' }

let root: Root | undefined
const renderRun = (text: string): HTMLElement => {
  const container = document.createElement('p')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(InlineReferenceModel.renderText(text, [AgentInlineReference.reference], prose)))
  return container
}

const links = (): readonly string[] => [...document.querySelectorAll('[data-dshfiles-agent-reference]')].map(element => element.textContent ?? '')

const previews = (): { readonly handles: string[]; readonly anchorIds: number[]; readonly stop: () => void } => {
  const seen: string[] = []
  const anchorIds: number[] = []
  const onRequest = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    const parsed = EntityPreview.decodeRequest(event.detail)
    if (parsed === null || parsed.kind !== 'agent') return
    seen.push(parsed.id)
    anchorIds.push(parsed.anchorId)
  }
  window.addEventListener(EntityPreview.event, onRequest)
  return { handles: seen, anchorIds, stop: () => window.removeEventListener(EntityPreview.event, onRequest) }
}

describe('agent inline references', () => {
  beforeEach(() => AgentInlineReference.setHandles(handles))
  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('shows a known mention, braced or legacy, as the same chip', () => {
    renderRun('Ask @luna and @{dsh} to fix b:1.')
    expect(links()).toEqual(['@luna', '@dsh'])
    expect(document.querySelectorAll('[data-ref-chip="agent"]')).toHaveLength(2)
    const first = document.querySelector('[data-dshfiles-agent-reference="luna"] button')
    expect(first?.getAttribute('aria-label')).toBe('Preview agent @luna')
  })

  it('leaves an unknown handle, a scope and an email address alone', () => {
    renderRun('@nobody and @agent:luna and luna@dsh.dev stay text')
    expect(links()).toEqual([])
  })

  it('follows the saved agent list: a newly saved agent links, and Chat is told to re-render', () => {
    const listener = vi.fn()
    const stop = AgentInlineReference.reference.vocabulary?.subscribe(listener)
    AgentInlineReference.setHandles(new Set(['luna', 'dsh']))
    expect(listener).not.toHaveBeenCalled()
    AgentInlineReference.setHandles(new Set(['luna', 'dsh', 'nova']))
    expect(listener).toHaveBeenCalledOnce()
    renderRun('Ping @{nova}')
    expect(links()).toEqual(['@nova'])
    stop?.()
  })

  it('opens the card from a click or the keyboard, anchored on the chip, and ignores a selection', () => {
    const { handles: seen, anchorIds, stop } = previews()
    renderRun('Working with @luna.')
    const chip = document.querySelector('[data-dshfiles-agent-reference] button')
    act(() => void chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    act(() => void chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    document.getSelection()?.selectAllChildren(document.body)
    act(() => void chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    expect(seen).toEqual(['luna', 'luna'])
    // The request carries the anchor the card re-measures when the page scrolls.
    expect(document.querySelector(`[data-dshfiles-entity-anchor="${String(anchorIds[0])}"]`)).toBe(chip)
    stop()
  })

  it('offers the card on hover after a short dwell', () => {
    vi.useFakeTimers()
    try {
      const { handles: seen, stop } = previews()
      renderRun('Working with @luna.')
      const chip = document.querySelector('[data-dshfiles-agent-reference] button')
      act(() => void chip?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
      expect(seen).toEqual([])
      act(() => vi.advanceTimersByTime(160))
      expect(seen).toEqual(['luna'])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the card from the native mention chip a sent message renders', () => {
    document.body.innerHTML = [
      '<div data-conversation-session="s">',
      '<button type="button" data-ref-chip="file" title="@luna">luna</button>',
      '<button type="button" data-ref-chip="file" title="@nobody">nobody</button>',
      '<div data-composer-card><button type="button" data-ref-chip="file" title="@dsh">dsh</button></div>',
      '</div>',
    ].join('')
    const { handles: seen, stop } = previews()
    const uninstall = installAgentMentionChips({ handles: () => handles })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    document.querySelector('[data-ref-chip][title="@luna"]')?.dispatchEvent(click)
    document.querySelector('[data-ref-chip][title="@nobody"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    document.querySelector('[data-composer-card] [data-ref-chip]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    expect(seen).toEqual(['luna'])
    // The chip is the conversation's own button; the card replaces its inert default.
    expect(click.defaultPrevented).toBe(true)
    uninstall()
    stop()
  })
})
