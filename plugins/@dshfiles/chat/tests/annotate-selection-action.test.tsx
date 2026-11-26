// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComposerService } from '@dshfiles/dshx/client'
import { AnnotateSelection } from '../src/native/chat/AnnotateSelection.tsx'

const attach = vi.fn(() => true)
const composer = { attach, focus: () => true }

// The primitives bundle pulls browser-only packages; only the phone check reaches this component.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ isMobileDevice: () => false }))

vi.mock('@dshfiles/dshx/client', () => ({
  Composer: {},
  useContract: () => ({ status: 'active', value: composer as unknown as ComposerService }),
}))

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })
  Range.prototype.getBoundingClientRect ??= () => DOMRect.fromRect({ x: 100, y: 200, width: 200, height: 20 })
  Range.prototype.getClientRects ??= () => {
    const rect = DOMRect.fromRect({ x: 100, y: 200, width: 200, height: 20 })
    return Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) })
  }
  HTMLElement.prototype.getBoundingClientRect ??= () => DOMRect.fromRect({ x: 0, y: 0, width: 720, height: 600 })
})
afterEach(() => {
  cleanup()
  attach.mockClear()
  document.body.replaceChildren()
})

const t = (key: string): string => key

const selectAssistantText = (): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = '<div data-chat-flow-kind="assistant-step" data-chat-flow-key="step-1"><p id="passage">Alpha beta gamma.</p></div>'
  document.body.append(host)
  const passage = host.querySelector('#passage')?.firstChild
  if (passage === null || passage === undefined) throw new Error('fixture missing')
  const range = document.createRange()
  range.setStart(passage, 0)
  range.setEnd(passage, 5)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return host
}

const reveal = (host: HTMLElement): void => {
  const passage = host.querySelector('#passage')
  if (passage === null) throw new Error('fixture missing')
  fireEvent.pointerDown(passage, { pointerType: 'mouse', button: 0 })
  fireEvent.pointerUp(document)
}

describe('AnnotateSelection quick add', () => {
  it('asks for the comment at the selection and attaches it in the same step', () => {
    const host = selectAssistantText()
    const containerRef = { current: host }
    render(<AnnotateSelection sessionId="s1" containerRef={containerRef} t={t as never} actionRow={null} quickComment="inline" />)
    reveal(host)
    fireEvent.click(screen.getByRole('button', { name: 'message.annotate' }))
    const editor = screen.getByPlaceholderText('annotation.quickAdd.placeholder')
    fireEvent.change(editor, { target: { value: 'any fn that is business logic' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(attach).toHaveBeenCalledExactlyOnceWith({
      sessionId: 's1',
      attachment: {
        kind: 'annotation',
        text: 'Alpha',
        source: 'step=step-1&block=0',
        comment: 'any fn that is business logic',
      },
    })
  })

  it('attaches silently when the quick-add preference says so', () => {
    const host = selectAssistantText()
    const containerRef = { current: host }
    render(<AnnotateSelection sessionId="s1" containerRef={containerRef} t={t as never} actionRow={null} quickComment="attach" />)
    reveal(host)
    fireEvent.click(screen.getByRole('button', { name: 'message.annotate' }))
    expect(screen.queryByPlaceholderText('annotation.quickAdd.placeholder')).toBeNull()
    expect(attach).toHaveBeenCalledExactlyOnceWith({
      sessionId: 's1',
      attachment: { kind: 'annotation', text: 'Alpha', source: 'step=step-1&block=0' },
    })
  })
})
