// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { InlineReferenceModel, type InlineReferenceContext } from '@dshfiles/chat/inline-references'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { activityPhrase } from './activity-phrase.js'
import { ActivityDescription } from './activity-description.js'
import { backlogInlineReference, BacklogReferenceText } from './backlog-inline-reference.js'
import { BacklogTriage } from './triage.js'
import { EntityPreview } from '@dshfiles/input-trigger/entity-registry'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | undefined
const cleanup = (): void => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
}

afterEach(() => {
  cleanup()
  document.getSelection()?.removeAllRanges()
})

const render = (node: JSX.Element): { readonly container: HTMLElement } => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(node))
  return { container }
}

const fireEvent = {
  click: (element: Element, init: MouseEventInit) => act(() => void element.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }))),
  keyDown: (element: Element, init: KeyboardEventInit) => act(() => void element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))),
}

const context = (surface: InlineReferenceContext['surface']): InlineReferenceContext => ({ sessionId: 's', cwd: undefined, surface, before: '' })

const renderRun = (text: string, surface: InlineReferenceContext['surface'] = 'prose') =>
  render(<p>{InlineReferenceModel.renderText(text, [backlogInlineReference], context(surface))}</p>)

const links = (container: Element): readonly string[] =>
  [...container.querySelectorAll('[data-dshfiles-backlog-reference]')].map(element => element.textContent ?? '')

const chipOf = (container: Element, ref?: string): HTMLButtonElement => {
  const wrapper = container.querySelector(ref === undefined ? '[data-dshfiles-backlog-reference]' : `[data-dshfiles-backlog-reference="${ref}"]`)
  const chip = wrapper?.querySelector('button')
  if (!(chip instanceof HTMLButtonElement)) throw new Error('no chip')
  return chip
}

const previews = (): { readonly requests: { readonly id: string; readonly anchorId: number }[]; readonly stop: () => void } => {
  const requests: { readonly id: string; readonly anchorId: number }[] = []
  const onRequest = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    const request = EntityPreview.decodeRequest(event.detail)
    if (request !== null && request.kind === 'backlog') requests.push({ id: String(request.id), anchorId: request.anchorId })
  }
  window.addEventListener(EntityPreview.event, onRequest)
  return { requests, stop: () => window.removeEventListener(EntityPreview.event, onRequest) }
}

describe('backlog inline references', () => {
  it('links an item number in prose and in inline code', () => {
    const { container } = renderRun('Next: b:12, then b:13.')
    expect(links(container)).toEqual(['b:12', 'b:13'])
    expect(container.querySelectorAll('[data-ref-chip="backlog"]')).toHaveLength(2)
    expect(chipOf(container, '12').getAttribute('aria-label')).toBe('Preview backlog item b:12')
    cleanup()
    expect(links(renderRun('b:13', 'code').container)).toEqual(['b:13'])
  })

  it('leaves words that only contain a token alone', () => {
    expect(links(renderRun('a/b:12 and rb:12 stay text, b:0 too').container)).toEqual([])
  })

  it('asks for a preview anchored on the chip when it is clicked', () => {
    const { requests, stop } = previews()
    const { container } = renderRun('Working on b:12.')
    const chip = chipOf(container)
    fireEvent.click(chip, { button: 0 })
    expect(requests.map(request => request.id)).toEqual(['12'])
    // The request carries the anchor the card re-measures when the page scrolls.
    expect(container.querySelector(`[data-dshfiles-entity-anchor="${String(requests[0]?.anchorId)}"]`)).toBe(chip)
    stop()
  })

  it('offers the same card on hover after a short dwell', () => {
    vi.useFakeTimers()
    try {
      const { requests, stop } = previews()
      const { container } = renderRun('Working on b:12.')
      const anchor = container.querySelector('[data-dshfiles-reference-anchor="backlog"]')
      const chip = chipOf(container)
      if (anchor === null) throw new Error('no anchor')
      act(() => void chip.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
      expect(requests).toEqual([])
      act(() => vi.advanceTimersByTime(160))
      expect(requests.map(request => request.id)).toEqual(['12'])
      expect(container.querySelector(`[data-dshfiles-entity-anchor="${String(requests[0]?.anchorId)}"]`)).toBe(anchor)
      const dismissed = vi.fn()
      window.addEventListener(EntityPreview.dismissEvent, dismissed)
      act(() => void anchor.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
      expect(dismissed).toHaveBeenCalledTimes(1)
      window.removeEventListener(EntityPreview.dismissEvent, dismissed)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not open a preview when the click extends a text selection', () => {
    const { requests, stop } = previews()
    const { container } = renderRun('Working on b:12.')
    document.getSelection()?.selectAllChildren(container)
    fireEvent.click(chipOf(container), { button: 0 })
    expect(requests).toEqual([])
    stop()
  })
})

describe('duplicate references in an item peek', () => {
  it('opens the duplicate item from a triage activity line', () => {
    const { requests, stop } = previews()
    const description = activityPhrase({ kind: 'triaged', actor: 'system', detail: 'suggested kind bug, duplicate of b:k3f9' }, 'none')
    const { container } = render(
      <p>
        <ActivityDescription description={description} threadId={undefined} threadLabel={() => ''} openThread={() => undefined} />
      </p>,
    )
    expect(container.textContent).toBe('triage suggested kind bug, duplicate of b:k3f9')
    expect(links(container)).toEqual(['b:k3f9'])
    fireEvent.click(chipOf(container, 'k3f9'), { button: 0 })
    expect(requests.map(request => request.id)).toEqual(['k3f9'])
    expect(container.querySelector(`[data-dshfiles-entity-anchor="${String(requests[0]?.anchorId)}"]`)).toBe(chipOf(container, 'k3f9'))
    stop()
  })

  it('opens the duplicate item from a triage suggestion summary', () => {
    const { requests, stop } = previews()
    const { container } = render(
      <p>
        <BacklogReferenceText text={BacklogTriage.describe({ kind: 'bug', duplicateOf: 7 }, () => 'k3f9')} />
      </p>,
    )
    expect(container.textContent).toBe('kind bug, duplicate of b:k3f9')
    expect(links(container)).toEqual(['b:k3f9'])
    fireEvent.click(chipOf(container, 'k3f9'), { button: 0 })
    expect(requests.map(request => request.id)).toEqual(['k3f9'])
    stop()
  })
})
