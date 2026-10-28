import { describe, expect, it } from 'vitest'
import { selectRecentPrompts } from './recent-prompts-source.js'

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
  it('projects recent prompts without a live Chat hook', () => {
    const chat = {
      order: ['first', 'second'],
      nodes: new Map([
        ['first', userNode(1, 'first prompt')],
        ['second', userNode(2, 'second prompt')],
      ]),
    }

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

    expect(selectRecentPrompts(chat).map(prompt => prompt.text)).toEqual(['usable'])
  })
})
