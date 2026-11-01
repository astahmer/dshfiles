import { Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { agentReferenceMatches, decodeAgentReferencePreviewRequest } from './agent-reference.js'

const handles = new Set(['luna', 'dsh'])

describe('agent reference matches', () => {
  it('finds a known mention in prose, at a sentence start and after punctuation', () => {
    expect(agentReferenceMatches('@luna fix b:1', handles)).toEqual([{ handle: 'luna', start: 0, end: 5 }])
    expect(agentReferenceMatches('Ask @luna, then @dsh.', handles)).toEqual([
      { handle: 'luna', start: 4, end: 9 },
      { handle: 'dsh', start: 16, end: 20 },
    ])
  })

  it('recognizes brace-wrapped references alongside existing plain mentions', () => {
    expect(agentReferenceMatches('Ask @{luna}, then @dsh.', handles)).toEqual([
      { handle: 'luna', start: 4, end: 11 },
      { handle: 'dsh', start: 18, end: 22 },
    ])
  })

  it('leaves an email address, a menu scope, unknown handles and longer slugs alone', () => {
    const text = 'mail luna@dsh.dev, @agent:luna, @nobody, @{nobody}, @luna-extra'
    expect(agentReferenceMatches(text, handles)).toEqual([])
  })

  it('keeps a mention written inside inline code a match, so the surface decides what to decorate', () => {
    expect(agentReferenceMatches('write `@luna` to dispatch', handles)).toEqual([{ handle: 'luna', start: 7, end: 12 }])
  })
})

describe('agent reference preview request', () => {
  const anchor = { left: 10, top: 20, width: 30, height: 12 }

  it('accepts a handle and the anchor the card follows', () => {
    expect(Option.isSome(decodeAgentReferencePreviewRequest({ handle: 'luna', anchorId: 1, anchor }))).toBe(true)
  })

  it('rejects an invalid handle and an anchor outside the document bounds', () => {
    expect(Option.isSome(decodeAgentReferencePreviewRequest({ handle: '@luna', anchorId: 1, anchor }))).toBe(false)
    expect(Option.isSome(decodeAgentReferencePreviewRequest({ handle: 'luna', anchorId: 1, anchor: { ...anchor, top: 200_000 } }))).toBe(false)
  })
})
