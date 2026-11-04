import { describe, expect, it } from 'vitest'

import { AgentReference } from './agent-reference.js'

const handles = new Set(['luna', 'dsh'])

describe('agent reference matches', () => {
  it('finds a known mention in prose, at a sentence start and after punctuation', () => {
    expect(AgentReference.matches('@luna fix b:1', handles)).toEqual([{ handle: 'luna', start: 0, end: 5 }])
    expect(AgentReference.matches('Ask @luna, then @dsh.', handles)).toEqual([
      { handle: 'luna', start: 4, end: 9 },
      { handle: 'dsh', start: 16, end: 20 },
    ])
  })

  it('recognizes brace-wrapped references alongside existing plain mentions', () => {
    expect(AgentReference.matches('Ask @{luna}, then @dsh.', handles)).toEqual([
      { handle: 'luna', start: 4, end: 11 },
      { handle: 'dsh', start: 18, end: 22 },
    ])
  })

  it('leaves an email address, a menu scope, unknown handles and longer slugs alone', () => {
    const text = 'mail luna@dsh.dev, @agent:luna, @nobody, @{nobody}, @luna-extra'
    expect(AgentReference.matches(text, handles)).toEqual([])
  })

  it('keeps a mention written inside inline code a match, so the surface decides what to decorate', () => {
    expect(AgentReference.matches('write `@luna` to dispatch', handles)).toEqual([{ handle: 'luna', start: 7, end: 12 }])
  })
})

describe('agent reference handles', () => {
  it('accepts a configured handle shape and rejects a mention or an invalid handle', () => {
    expect(AgentReference.isHandle('luna')).toBe(true)
    expect(AgentReference.isHandle('@luna')).toBe(false)
    expect(AgentReference.isHandle('Luna Bot')).toBe(false)
  })
})
