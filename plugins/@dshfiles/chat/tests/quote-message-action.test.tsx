// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Composer, type ComposerService } from '@dshfiles/dshx/client'
import { BrowserBroker } from '../../../../tooling/dshx/packages/dshx/src/client/broker.ts'
import { QuoteMessageAction } from '../src/quote-message-action.tsx'
import type { ChatViewSlotProps } from '../src/native/contract/slots.ts'

// The upstream primitive bundle imports undeclared simple-icons; isolate that unrelated tooltip wrapper.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Tooltip: (props: { children: ReactNode }) => props.children }))

const translate: ChatViewSlotProps['t'] = (key, params) => {
  if (key === 'message.quote') return 'Quote message'
  if (key === 'message.quoteFailed') return 'Could not insert quote. Wait for the composer to become editable, then try again.'
  if (key === 'message.quoteSource') return `${params?.role} · ${params?.sessionId} · message ${params?.seq}`
  return key === 'message.quoteAssistant' ? 'Assistant' : 'User'
}

const provideComposer = (insert: ComposerService['insert']) => {
  const composer: ComposerService = {
    current: { get: () => 'session-quote', subscribe: () => () => {} },
    focused: { get: () => false, subscribe: () => () => {} },
    text: () => '',
    setText: () => false,
    insert,
    attach: () => false,
    setModel: async () => false,
    focus: () => true,
  }
  BrowserBroker.provide(Composer, composer, Composer.owner ?? '@dshfiles/rich-composer')
}

afterEach(() => {
  cleanup()
  BrowserBroker.reset()
  window.getSelection()?.removeAllRanges()
})

it('shows a live recoverable failure without changing the control name, then clears it on retry or blur', () => {
  let editable = false
  provideComposer(() => editable)
  render(<QuoteMessageAction source={{ role: 'assistant', sessionId: 'session-quote', seq: 5, turn: 1 }} text="Answer" className={undefined} t={translate} />)
  const button = screen.getByRole('button', { name: 'Quote message' })
  fireEvent.click(button)
  expect(screen.getByRole('status').textContent).toContain('Wait for the composer to become editable, then try again.')
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  expect(screen.getByRole('button', { name: 'Quote message' })).toBe(button)
  editable = true
  fireEvent.click(button)
  expect(screen.getByRole('status').textContent).toBe('')
  editable = false
  fireEvent.click(button)
  fireEvent.blur(button)
  expect(screen.getByRole('status').textContent).toBe('')
})

it('attributes an earlier selected assistant step to its actual sequence instead of the final answer', () => {
  let inserted = ''
  provideComposer(input => {
    inserted = input.text
    return true
  })
  render(
    <div data-chat-flow>
      <div data-chat-flow-kind="assistant-step" data-chat-turn="1" data-chat-message-seq="3">
        Earlier selected step
      </div>
      <div data-chat-flow-kind="turn-tail">
        <QuoteMessageAction
          source={{ role: 'assistant', sessionId: 'session-quote', seq: 5, turn: 1 }}
          text="Final answer"
          className={undefined}
          t={translate}
        />
      </div>
    </div>,
  )
  const range = document.createRange()
  range.selectNodeContents(screen.getByText('Earlier selected step'))
  window.getSelection()?.addRange(range)
  fireEvent.click(screen.getByRole('button', { name: 'Quote message' }))
  expect(inserted).toBe('> Assistant · session-quote · message 3\n>\n> Earlier selected step\n\n')
})
