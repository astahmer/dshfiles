// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryReferenceModel, memoryReferencePreviewEvent } from './memory-reference.ts'
import { MemoryInlineReference } from './memory-reference-links.tsx'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | undefined
/** Render a Markdown-shaped tree through Chat's transform, the way Chat renders an answer. */
const renderTree = (tree: ReactNode): void => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(InlineReferenceModel.transform(tree, InlineReferenceModel.state([MemoryInlineReference.reference]))))
}

const links = (): readonly string[] => [...document.querySelectorAll('[data-dshfiles-memory-reference]')].map(element => element.textContent ?? '')

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

describe('memory inline references', () => {
  it('makes the whole citation the link, and only the id for a backticked reference', () => {
    // A backticked id renders as its own <code> element, so that citation cannot reach back over `memory:`.
    renderTree(createElement('p', null, 'Earlier: Memory: t:9356abc7, n:3 and memory: ', createElement('code', { key: 'code' }, 'n:7'), '.'))
    expect(links()).toEqual(['Memory: t:9356abc7', 'n:3', 'n:7'])
    expect(document.querySelector('code [data-dshfiles-memory-reference="n:7"]')).not.toBeNull()
  })

  it('keeps a range and leaves ids that are not cited, or cited in another block, alone', () => {
    renderTree(
      createElement(
        'div',
        null,
        createElement('p', { key: 'a' }, 'See memory:'),
        createElement('p', { key: 'b' }, createElement('code', null, 'n:4'), ' and t:x without a citation, then memory: t:abc#12'),
      ),
    )
    expect(links()).toEqual(['memory: t:abc#12'])
    expect(document.querySelector('[data-dshfiles-memory-reference="t:abc"]')?.getAttribute('data-dshfiles-memory-range')).toBe('12')
  })

  it('asks for a preview when one of those links is clicked or entered', () => {
    const requests: { readonly id: string; readonly anchorId: number }[] = []
    const onRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const request = MemoryReferenceModel.decodePreviewRequest(event.detail)
      if (request !== null) requests.push(request)
    }
    window.addEventListener(memoryReferencePreviewEvent, onRequest)
    renderTree(createElement('p', null, 'Memory: t:9356abc7.'))
    const link = document.querySelector('[data-dshfiles-memory-reference]')
    act(() => void link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    act(() => void link?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(requests.map(request => request.id)).toEqual(['t:9356abc7', 't:9356abc7'])
    // The request carries the anchor the card re-measures when the page scrolls.
    expect(document.querySelector(`[data-dshfiles-memory-preview-anchor="${String(requests[0]?.anchorId)}"]`)).toBe(link)
    window.removeEventListener(memoryReferencePreviewEvent, onRequest)
  })

  it('matches a sent message citation as a user-text node covering the citation, then each later reference', () => {
    const read = { read: () => undefined }
    const rule = MemoryInlineReference.userTextRule
    const text = 'Per memory: n:1, `t:abc#2` — ok'
    const first = rule.match(text, 0, read)
    expect(first).toEqual({ id: 'memory', start: text.indexOf('memory:'), end: text.indexOf(',') , data: { id: 'n:1', range: null } })
    const second = rule.match(text, first?.end ?? 0, read)
    expect(second).toEqual({ id: 'memory', start: text.indexOf('t:abc'), end: text.indexOf('#2') + 2, data: { id: 't:abc', range: '2' } })
    expect(rule.match(text, second?.end ?? 0, read)).toBeUndefined()
  })
})
