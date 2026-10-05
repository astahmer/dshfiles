import { describe, expect, it } from 'vitest'
import { areRecentPromptsEqual, MAX_RECENT_PROMPTS, projectRecentPrompts } from './recent-prompts.js'

const chatNode = (id: string, seq: number, content: readonly unknown[], sourceKind = 'user', kind = 'user', anchorSeq = seq) => ({
  id,
  kind,
  target: 'chat',
  anchorSeq,
  data: {
    kind: 'user',
    seq,
    time: seq * 1_000,
    content,
    source: { kind: sourceKind },
  },
})

describe('recent sent prompts', () => {
  it('keeps newest user text in reverse order and excludes attachments and non-user messages', () => {
    const prompts = projectRecentPrompts([
      chatNode('wrong-kind', 6, [{ type: 'text', text: 'not a user row' }], 'user', 'assistant'),
      chatNode('second', 5, [
        { type: 'text', text: ' second ' },
        { type: 'text', text: 'line ' },
      ]),
      chatNode('attachment-only', 4, [{ type: 'image' }]),
      chatNode('agent', 3, [{ type: 'text', text: 'agent context' }], 'agent-context'),
      chatNode('steered', 2, [{ type: 'text', text: 'steered' }], 'steering'),
      chatNode('first', 1, [{ type: 'text', text: 'first\nprompt' }, { type: 'image' }]),
    ])

    expect(prompts).toEqual([
      { id: 'second:5', seq: 5, time: 5_000, text: ' second line ' },
      { id: 'first:1', seq: 1, time: 1_000, text: 'first\nprompt' },
    ])
  })

  it('ignores malformed rows and mismatched event anchors', () => {
    const prompts = projectRecentPrompts([
      { id: 'bad-shape', kind: 'user', target: 'chat', anchorSeq: 1, data: { kind: 'user' } },
      chatNode('mismatch', 2, [{ type: 'text', text: 'stale row' }], 'user', 'user', 3),
    ])

    expect(prompts).toEqual([])
  })

  it('skips blank and oversized text rather than truncating a sent prompt', () => {
    const prompts = projectRecentPrompts([
      chatNode('blank', 1, [{ type: 'text', text: ' \n ' }]),
      chatNode('oversized', 2, [{ type: 'text', text: 'x'.repeat(20_001) }]),
      chatNode('valid', 3, [{ type: 'text', text: 'usable' }]),
    ])

    expect(prompts.map(prompt => prompt.id)).toEqual(['valid:3'])
  })

  it('deduplicates stable node identities and bounds the visible history', () => {
    const nodes = Array.from({ length: MAX_RECENT_PROMPTS + 2 }, (_, index) => chatNode('message-' + index, index, [{ type: 'text', text: 'prompt ' + index }]))
    const lastNode = nodes.at(-1)
    if (lastNode !== undefined) nodes.push(lastNode)

    const prompts = projectRecentPrompts(nodes.toReversed())

    expect(prompts).toHaveLength(MAX_RECENT_PROMPTS)
    expect(prompts[0]?.text).toBe('prompt 21')
    expect(prompts.at(-1)?.text).toBe('prompt 2')
  })

  it('compares the projected values so unchanged chats do not re-render the action', () => {
    const prompt = { id: 'one:1', seq: 1, time: 1_000, text: 'same' }

    expect(areRecentPromptsEqual([prompt], [{ ...prompt }])).toBe(true)
    expect(areRecentPromptsEqual([prompt], [{ ...prompt, text: 'changed' }])).toBe(false)
    expect(areRecentPromptsEqual([prompt], [])).toBe(false)
  })
})
