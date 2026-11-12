import { describe, expect, it } from 'vitest'
import { RouteRules } from './route-rule-table.js'

describe('route rules', () => {
  it('reads a stored record as account and model rows and writes it back unchanged', () => {
    const record = { 'claude_work/*': 'long', 'codex_home/openai/gpt-6': 'short' } as const
    const rules = RouteRules.of(record)
    expect(rules).toEqual([
      { route: 'claude_work', model: '*', value: 'long' },
      { route: 'codex_home', model: 'openai/gpt-6', value: 'short' },
    ])
    expect(RouteRules.record(rules)).toEqual(record)
  })

  it('drops keys with no route or no model', () => {
    expect(RouteRules.of({ '/x': 1, 'route/': 2, nothing: 3 })).toEqual([])
  })
})
