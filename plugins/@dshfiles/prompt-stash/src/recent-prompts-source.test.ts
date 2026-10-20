import { describe, expect, it } from 'vitest'
import { areSentPromptsEqual, selectRecentPrompts, selectSentPrompts } from './recent-prompts-source.js'

const userNode = (seq: number, text: string, extra: readonly unknown[] = []) => ({
  id: `node-${seq}`,
  kind: 'user',
  target: 'chat',
  anchorSeq: seq,
  data: {
    kind: 'user',
    seq,
    time: seq * 1_000,
    content: [{ type: 'text', text }, ...extra],
    source: { kind: 'user' },
  },
})

describe('Chat source selectors', () => {
  it('projects sent prompts without a live Chat hook', () => {
    const chat = {
      order: ['first', 'second'],
      nodes: new Map([
        ['first', userNode(1, 'first prompt')],
        ['second', userNode(2, 'second prompt')],
      ]),
    }

    expect(selectSentPrompts(chat)).toEqual([
      { id: 2, text: 'second prompt' },
      { id: 1, text: 'first prompt' },
    ])
    expect(selectRecentPrompts(chat).map(prompt => prompt.text)).toEqual(['second prompt', 'first prompt'])
  })

  it('skips malformed and attachment-only rows', () => {
    const chat = {
      order: ['attachment', 'malformed', 'valid'],
      nodes: new Map<string, { data: unknown }>([
        ['attachment', userNode(1, '', [{ type: 'image' }])],
        ['malformed', { data: { kind: 'user' } }],
        ['valid', userNode(3, 'usable')],
      ]),
    }

    expect(selectSentPrompts(chat)).toEqual([{ id: 3, text: 'usable' }])
  })

  it('compares projected sent prompts by identity and text', () => {
    expect(areSentPromptsEqual([{ id: 1, text: 'same' }], [{ id: 1, text: 'same' }])).toBe(true)
    expect(areSentPromptsEqual([{ id: 1, text: 'same' }], [{ id: 1, text: 'changed' }])).toBe(false)
    expect(areSentPromptsEqual([{ id: 1, text: 'same' }], [])).toBe(false)
  })
})
