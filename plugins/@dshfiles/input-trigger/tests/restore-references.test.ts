import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'

import { InputTriggerController, type SourceRoster } from '../src/client/controller.js'
import type { InputTriggerSource, RestoredReference } from '../src/types.js'

const source = (over: Partial<InputTriggerSource> & Pick<InputTriggerSource, 'name'>): InputTriggerSource => ({
  trigger: '@',
  candidates: async () => [],
  onPick: () => undefined,
  ...over,
})

const controllerFor = (sources: readonly InputTriggerSource[]): InputTriggerController => {
  const roster: SourceRoster = { sources: trigger => sources.filter(item => item.trigger === trigger), all: () => sources }
  return new InputTriggerController({ actx: new Context(), sessionId: SessionId('session-1'), roster })
}

const chip = (input: { readonly name: string; readonly text: string; readonly start: number }): RestoredReference => ({
  source: input.name,
  ref: input.name,
  label: input.name,
  clipboardText: input.text.slice(input.start, input.start + 5),
  start: input.start,
  end: input.start + 5,
})

describe('reference restore', () => {
  it('collects spans from every source, ordered, and drops overlaps', () => {
    const text = 'alpha bravo charl'
    const controller = controllerFor([
      source({ name: 'second', restore: () => [chip({ name: 'second', text, start: 6 })] }),
      source({ name: 'first', restore: () => [chip({ name: 'first', text, start: 0 }), chip({ name: 'first', text, start: 6 })] }),
      source({ name: 'none' }),
    ])
    expect(controller.restoreReferences(text).map(span => [span.source, span.start])).toEqual([
      ['first', 0],
      ['second', 6],
    ])
  })

  it('drops a span whose text no longer matches its clipboard projection or bounds', () => {
    const text = 'alpha bravo'
    const controller = controllerFor([
      source({
        name: 'stale',
        restore: () => [
          { source: 'stale', ref: 'x', label: 'x', clipboardText: 'changed', start: 0, end: 5 },
          { source: 'stale', ref: 'x', label: 'x', clipboardText: 'bravo', start: 6, end: 99 },
        ],
      }),
    ])
    expect(controller.restoreReferences(text)).toEqual([])
  })

  it('skips a source that throws instead of failing the whole restore', () => {
    const text = 'alpha'
    const controller = controllerFor([
      source({
        name: 'broken',
        restore: () => {
          throw new Error('boom')
        },
      }),
      source({ name: 'fine', restore: () => [chip({ name: 'fine', text, start: 0 })] }),
    ])
    expect(controller.restoreReferences(text)).toHaveLength(1)
  })
})
