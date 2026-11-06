import { describe, expect, it } from 'vitest'
import { savingOutcome, settleSave, type SaveOutcome } from './save-outcome.js'

type Edit = { readonly value: number }

const start = (outcomes: ReadonlyMap<string, SaveOutcome<Edit>>, key: string, edit: Edit) => {
  const outcome = savingOutcome(edit)
  return { outcome, outcomes: new Map(outcomes).set(key, outcome) }
}

describe('per-setting save outcome', () => {
  it('keeps a write in flight until it settles, then clears it', () => {
    const first = start(new Map(), 'a', { value: 1 })
    expect(first.outcomes.get('a')).toEqual({ status: 'saving', edit: { value: 1 } })
    expect(settleSave(first.outcomes, 'a', first.outcome, true).has('a')).toBe(false)
  })

  it('keeps a refusal visible on its own row only', () => {
    const first = start(new Map(), 'a', { value: 1 })
    const second = start(first.outcomes, 'b', { value: 2 })
    const settled = settleSave(second.outcomes, 'a', first.outcome, false)
    expect(settled.get('a')).toEqual({ status: 'refused' })
    expect(settled.get('b')).toEqual({ status: 'saving', edit: { value: 2 } })
  })

  it('ignores a settlement from a write another one replaced', () => {
    const first = start(new Map(), 'a', { value: 1 })
    const second = start(first.outcomes, 'a', { value: 2 })
    expect(settleSave(second.outcomes, 'a', first.outcome, false)).toBe(second.outcomes)
    expect(second.outcomes.get('a')).toEqual({ status: 'saving', edit: { value: 2 } })
    expect(settleSave(second.outcomes, 'a', second.outcome, false).get('a')).toEqual({ status: 'refused' })
  })

  it('clears a refusal when the next write starts', () => {
    const first = start(new Map(), 'a', { value: 1 })
    const refused = settleSave(first.outcomes, 'a', first.outcome, false)
    const retried = start(refused, 'a', { value: 1 })
    expect(retried.outcomes.get('a')).toEqual({ status: 'saving', edit: { value: 1 } })
  })
})
