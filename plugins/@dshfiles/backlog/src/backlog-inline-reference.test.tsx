// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { InlineReferenceModel, type InlineReferenceContext } from '@dshfiles/chat/inline-references'
import { Option, Schema } from 'effect'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { backlogInlineReference } from './backlog-inline-reference.js'
import { backlogReferencePreviewEvent, backlogReferencePreviewRequestSchema } from './backlog-reference.js'

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

const links = (container: Element): readonly string[] => [...container.querySelectorAll('[data-dshfiles-backlog-reference]')].map(element => element.textContent ?? '')

const previews = (): { readonly requests: { readonly id: number; readonly anchorId: number }[]; readonly stop: () => void } => {
  const requests: { readonly id: number; readonly anchorId: number }[] = []
  const onRequest = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    const request = Option.getOrNull(Schema.decodeUnknownOption(backlogReferencePreviewRequestSchema)(event.detail))
    if (request !== null) requests.push(request)
  }
  window.addEventListener(backlogReferencePreviewEvent, onRequest)
  return { requests, stop: () => window.removeEventListener(backlogReferencePreviewEvent, onRequest) }
}

describe('backlog inline references', () => {
  it('links an item number in prose and in inline code', () => {
    const { container } = renderRun('Next: b:12, then b:13.')
    expect(links(container)).toEqual(['b:12', 'b:13'])
    const first = container.querySelector('[data-dshfiles-backlog-reference="12"]')
    expect(first?.getAttribute('role')).toBe('link')
    expect(first?.getAttribute('aria-label')).toBe('Preview backlog item b:12')
    cleanup()
    expect(links(renderRun('b:13', 'code').container)).toEqual(['b:13'])
  })

  it('leaves words that only contain a token alone', () => {
    expect(links(renderRun('a/b:12 and rb:12 stay text, b:0 too').container)).toEqual([])
  })

  it('asks for a preview anchored on the link when it is clicked or activated by keyboard', () => {
    const { requests, stop } = previews()
    const { container } = renderRun('Working on b:12.')
    const link = container.querySelector('[data-dshfiles-backlog-reference]')
    if (link === null) throw new Error('no link')
    fireEvent.click(link, { button: 0 })
    fireEvent.keyDown(link, { key: 'Enter' })
    expect(requests.map(request => request.id)).toEqual([12, 12])
    // The request carries the anchor the card re-measures when the page scrolls.
    expect(container.querySelector(`[data-dshfiles-backlog-preview-anchor="${String(requests[0]?.anchorId)}"]`)).toBe(link)
    stop()
  })

  it('does not open a preview when the click extends a text selection', () => {
    const { requests, stop } = previews()
    const { container } = renderRun('Working on b:12.')
    document.getSelection()?.selectAllChildren(container)
    const link = container.querySelector('[data-dshfiles-backlog-reference]')
    if (link !== null) fireEvent.click(link, { button: 0 })
    expect(requests).toEqual([])
    stop()
  })
})
