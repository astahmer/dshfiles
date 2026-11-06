import { describe, expect, it } from 'vitest'
import { createCardSeat } from '../src/card-visibility.js'

const createHarness = (options: { readonly published?: boolean } = {}) => {
  const calls: string[] = []
  let nextPublish = 0
  const seat = createCardSeat({
    published: options.published ?? true,
    publish: () => {
      nextPublish += 1
      const entry = `publish-${String(nextPublish)}`
      calls.push(entry)
      return () => {
        calls.push(`withdraw-${String(nextPublish)}`)
      }
    },
  })
  return { calls, seat }
}

describe('card visibility', () => {
  it('publishes on creation, and a silent card stays withdrawn until it is revealed', () => {
    const shown = createHarness()
    const hidden = createHarness({ published: false })
    expect(shown.calls).toEqual(['publish-1'])
    expect(hidden.calls).toEqual([])

    hidden.seat.reveal()
    expect(hidden.calls).toEqual(['publish-1'])
  })

  it('withdraws a shown card once and ignores a second hide', () => {
    const { calls, seat } = createHarness()
    seat.hide()
    seat.hide()
    expect(calls).toEqual(['publish-1', 'withdraw-1'])
  })

  it('republishes a revealed card last, withdrawing the seat it held', () => {
    const { calls, seat } = createHarness()
    seat.reveal()
    expect(calls).toEqual(['publish-1', 'withdraw-1', 'publish-2'])
  })

  it('drops the seat for good on removal', () => {
    const { calls, seat } = createHarness()
    seat.remove()
    seat.reveal()
    seat.hide()
    expect(calls).toEqual(['publish-1', 'withdraw-1'])
  })
})
