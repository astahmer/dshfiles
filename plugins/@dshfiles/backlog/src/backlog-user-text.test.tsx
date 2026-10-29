// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import type { UserTextTransformContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { BacklogMentionChip } from './backlog-mention-chip.js'
import { backlogReferencePreviewEvent, backlogReferencePreviewRequestSchema } from './backlog-reference.js'
import { backlogUserTextRule } from './backlog-user-text.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const noFacts: UserTextTransformContext = { read: () => undefined }

describe('backlog sent mentions', () => {
  it('covers the whole serialized mention with one node', () => {
    const text = 'b:12 "Composer drops chips" (backlog item; backlog_get has its details)'

    expect(backlogUserTextRule.match(text, 0, noFacts)).toEqual({
      id: 'backlog',
      start: 0,
      end: text.length,
      data: { id: 12, title: 'Composer drops chips' },
    })
  })

  it('turns a bare item number into a chip without swallowing the prose around it', () => {
    expect(backlogUserTextRule.match('Working on b:12 today', 0, noFacts)).toEqual({
      id: 'backlog',
      start: 'Working on '.length,
      end: 'Working on b:12'.length,
      data: { id: 12, title: null },
    })
  })

  it('renders the composer chip shape and opens the shared preview when clicked', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const requests: unknown[] = []
    const onRequest = (event: Event): void => {
      if (event instanceof CustomEvent) requests.push(event.detail)
    }
    window.addEventListener(backlogReferencePreviewEvent, onRequest)

    try {
      await act(async () => {
        root.render(<BacklogMentionChip node={{ id: 'backlog', start: 0, end: 5, data: { id: 12, title: 'Composer drops chips' } }} interactive />)
      })
      const button = container.querySelector('button')
      expect(button?.textContent).toBe('b:12 · Composer drops chips')
      expect(button?.getAttribute('data-ref-chip')).toBe('backlog')
      expect(container.querySelector('[aria-label="Copy b:12 reference"]')).not.toBeNull()

      await act(async () => button?.click())

      expect(backlogReferencePreviewRequestSchema.safeParse(requests[0]).success).toBe(true)
      expect(requests[0]).toMatchObject({ id: 12 })
    } finally {
      await act(async () => root.unmount())
      window.removeEventListener(backlogReferencePreviewEvent, onRequest)
      container.remove()
    }
  })

  it('shows a sent echo without an action', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(<BacklogMentionChip node={{ id: 'backlog', start: 0, end: 4, data: { id: 7, title: null } }} interactive={false} />)
    })
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[data-ref-chip="backlog"]')?.textContent).toBe('b:7')
    act(() => root.unmount())
    container.remove()
  })
})
