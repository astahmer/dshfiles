import { describe, expect, it } from 'vitest'
import { splitPromptFences } from '../src/native/chat/prompt-fold.ts'

describe('splitPromptFences', () => {
  it('keeps a prompt without a fence whole', () => {
    expect(splitPromptFences('Review this\nplease')).toEqual([{ kind: 'text', text: 'Review this\nplease' }])
  })

  it('cuts prose and a fenced block apart without the markers', () => {
    expect(splitPromptFences('Review this:\n```json\n{ "a": 1 }\n```\nThanks')).toEqual([
      { kind: 'text', text: 'Review this:' },
      { kind: 'code', lang: 'json', code: '{ "a": 1 }' },
      { kind: 'text', text: 'Thanks' },
    ])
  })

  it('runs an unclosed fence to the end of the prompt', () => {
    expect(splitPromptFences('```ts\nconst a = 1\nconst b = 2')).toEqual([{ kind: 'code', lang: 'ts', code: 'const a = 1\nconst b = 2' }])
  })

  it('reads a fence with no language', () => {
    expect(splitPromptFences('```\nraw\n```')).toEqual([{ kind: 'code', lang: '', code: 'raw' }])
  })
})
