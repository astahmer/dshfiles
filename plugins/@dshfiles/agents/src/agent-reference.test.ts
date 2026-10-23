import { describe, expect, it } from 'vitest'

import { agentReferenceMatches, agentReferencePreviewRequestSchema } from './agent-reference.js'

const handles = new Set(['luna', 'dsh'])

describe('agent reference matches', () => {
  it('finds a known mention in prose, at a sentence start and after punctuation', () => {
    expect(agentReferenceMatches('@luna fix b:1', handles)).toEqual([{ handle: 'luna', start: 0, end: 5 }])
    expect(agentReferenceMatches('Ask @luna, then @dsh.', handles)).toEqual([
      { handle: 'luna', start: 4, end: 9 },
      { handle: 'dsh', start: 16, end: 20 },
    ])
  })

  it('leaves an email address, a menu scope, an unknown handle and a longer slug alone', () => {
    const text = 'mail luna@dsh.dev, @agent:luna, @nobody, @luna-extra'
    expect(agentReferenceMatches(text, handles)).toEqual([])
  })

  it('keeps a mention written inside inline code a match, so the surface decides what to decorate', () => {
    expect(agentReferenceMatches('write `@luna` to dispatch', handles)).toEqual([{ handle: 'luna', start: 7, end: 12 }])
  })
})

describe('agent reference preview request', () => {
  const anchor = { left: 10, top: 20, width: 30, height: 12 }

  it('accepts a handle and the anchor the card follows', () => {
    expect(agentReferencePreviewRequestSchema.safeParse({ handle: 'luna', anchorId: 1, anchor }).success).toBe(true)
  })

  it('rejects an invalid handle and an anchor outside the document bounds', () => {
    expect(agentReferencePreviewRequestSchema.safeParse({ handle: '@luna', anchorId: 1, anchor }).success).toBe(false)
    expect(agentReferencePreviewRequestSchema.safeParse({ handle: 'luna', anchorId: 1, anchor: { ...anchor, top: 200_000 } }).success).toBe(false)
  })
})
