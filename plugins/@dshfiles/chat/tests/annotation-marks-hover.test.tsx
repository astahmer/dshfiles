// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComposerAnnotation } from '@dshfiles/dshx/client'
import { AnnotationMarks } from '../src/native/chat/annotation-marks.tsx'

const annotation: ComposerAnnotation = {
  id: 'draft:1',
  text: 'Alpha beta',
  comment: '',
  source: 'step=step-1&block=0',
  sent: false,
}

// One stable snapshot: useSyncExternalStore compares identity on every read.
const annotations: readonly ComposerAnnotation[] = [annotation]

const composer = {
  annotations: () => ({ subscribe: () => () => undefined, get: () => annotations }),
  removeAnnotation: vi.fn(),
  setAnnotationComment: vi.fn(),
}

vi.mock('@dshfiles/dshx/client', () => ({
  Composer: {},
  useContract: () => ({ status: 'active', value: composer }),
}))

beforeAll(() => {
  // One coalesced frame per schedule, like the browser's; the assertions await the result.
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(0), 0)
  window.cancelAnimationFrame = id => window.clearTimeout(id)
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Range.prototype.getBoundingClientRect ??= () => DOMRect.fromRect({ x: 100, y: 200, width: 200, height: 20 })
  Range.prototype.getClientRects ??= () => {
    const rect = DOMRect.fromRect({ x: 100, y: 200, width: 200, height: 20 })
    return Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) })
  }
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

const t = (key: string): string => key

/** One rendered assistant passage, outside the React tree like the transcript the markers point into. */
const transcript = (): HTMLElement => {
  const container = document.createElement('div')
  container.innerHTML = '<div data-chat-flow-kind="assistant-step" data-chat-flow-key="step-1"><p>Alpha beta gamma.</p></div>'
  document.body.append(container)
  return container
}

describe('AnnotationMarks hover shape', () => {
  it('opens the comment on hover and takes it away once the pointer leaves', async () => {
    const container = transcript()
    render(<AnnotationMarks sessionId="s1" containerRef={{ current: container }} mode="hover" t={t as never} />)
    const marker = await screen.findByRole('button', { name: 'annotation.marks.marker' })
    fireEvent.pointerOver(marker, { pointerType: 'mouse' })
    const quote = await screen.findByText('Alpha beta')
    fireEvent.pointerOut(marker, { pointerType: 'mouse', relatedTarget: document.body })
    await waitForElementToBeRemoved(quote)
  })

  it('keeps the comment closed until the marker is hovered', async () => {
    const container = transcript()
    render(<AnnotationMarks sessionId="s1" containerRef={{ current: container }} mode="hover" t={t as never} />)
    await screen.findByRole('button', { name: 'annotation.marks.marker' })
    expect(screen.queryByText('Alpha beta')).toBeNull()
  })

  it('removes the marker while an ancestor hides the mounted thread', async () => {
    const host = document.createElement('div')
    host.style.visibility = 'visible'
    const container = document.createElement('div')
    container.innerHTML = '<div data-chat-flow-kind="assistant-step" data-chat-flow-key="step-1"><p>Alpha beta gamma.</p></div>'
    host.append(container)
    document.body.append(host)
    render(<AnnotationMarks sessionId="s1" containerRef={{ current: container }} mode="column" t={t as never} />)
    await screen.findByRole('button', { name: 'annotation.marks.marker' })
    host.style.visibility = 'hidden'
    await waitFor(() => expect(screen.queryByRole('button', { name: 'annotation.marks.marker' })).toBeNull())
  })

  it('keeps the card open while focus moves from the marker into it', async () => {
    const container = transcript()
    render(<AnnotationMarks sessionId="s1" containerRef={{ current: container }} mode="hover" t={t as never} />)
    const marker = await screen.findByRole('button', { name: 'annotation.marks.marker' })
    fireEvent.focus(marker)
    const quote = await screen.findByText('Alpha beta')
    const action = screen.getByRole('button', { name: 'annotation.marks.edit' })
    fireEvent.blur(marker, { relatedTarget: action })
    await new Promise(resolve => {
      setTimeout(resolve, 300)
    })
    expect(quote.isConnected).toBe(true)
  })
})
