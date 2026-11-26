// @vitest-environment jsdom
/**
 * Question choices in a peek (council round 11 C6): unselected answers are quiet triggers (`variant="field"`), the
 * recommended answer differs by its attention tint only (`variant="attention"`), both at the body weight, so the row
 * of answers reads as calm choices with one suggestion rather than an ink primary beside outlined buttons.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PeekCard } from '../src/components/peek.js'

afterEach(cleanup)

const labels = { lastReply: 'Last reply', noReply: 'No reply yet', loading: 'Loading', close: 'Close' }

describe('PeekCard question choices (council round 11 C6)', () => {
  it('draws unselected answers as quiet triggers and the recommended one by its attention tint, both at 400', () => {
    const view = render(
      <PeekCard
        heading="Reconcile Stripe payouts"
        question={{
          text: 'Which payouts should I match first?',
          choices: [
            { id: 'a', label: 'The oldest', recommended: true },
            { id: 'b', label: 'The largest' },
          ],
          onAnswer: () => undefined,
        }}
        labels={labels}
      />,
    )
    const recommended = view.getByRole('button', { name: /The oldest/u })
    const other = view.getByRole('button', { name: /The largest/u })
    expect(recommended.getAttribute('data-variant')).toBe('attention')
    expect(other.getAttribute('data-variant')).toBe('field')
    for (const button of [recommended, other]) {
      const classes = button.className.split(/\s+/u)
      expect(classes).toContain('dshx:font-normal')
      expect(classes).not.toContain('dshx:font-medium')
      expect(['default', 'outline']).not.toContain(button.getAttribute('data-variant'))
    }
  })
})
