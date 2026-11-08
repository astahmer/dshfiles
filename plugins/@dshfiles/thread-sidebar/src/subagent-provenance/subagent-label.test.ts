import { describe, expect, it } from 'vitest'
import { SUBAGENT_LABEL_MAX, subagentLabel } from './subagent-label.js'

describe('subagentLabel', () => {
  it('uses the description the agent gave the delegation, not the prompt', () => {
    expect(subagentLabel({ description: 'Review parser', prompt: 'Long instructions' })).toBe('Review parser')
  })

  it('falls back to a label, then to the first non-empty prompt line', () => {
    expect(subagentLabel({ label: 'Audit tests', prompt: 'x' })).toBe('Audit tests')
    expect(subagentLabel({ description: '  ', prompt: '\n\n  Fix the  flaky\ttest  \nThen report back.' })).toBe('Fix the flaky test')
  })

  it('clips a long line with an ellipsis', () => {
    const label = subagentLabel({ prompt: 'a'.repeat(200) }) ?? ''
    expect(Array.from(label)).toHaveLength(SUBAGENT_LABEL_MAX)
    expect(label.endsWith('…')).toBe(true)
  })

  it('reports nothing when the call has no text yet', () => {
    expect(subagentLabel(null)).toBeUndefined()
    expect(subagentLabel({ prompt: '' })).toBeUndefined()
  })
})
