import { describe, expect, test } from 'vitest'
import { PromptRecallModel, type RecallDirection } from './prompt-recall.ts'

const userPrompt = (text: string, kind = 'user') => ({
  type: 'event',
  event: { type: 'user/message', seq: 1, time: 0, data: { id: 'm', role: 'user', source: { kind }, content: [{ type: 'text', text }] } },
})

const prompts = ['newest', 'middle\nsecond line', 'oldest']

const driver = () => {
  const recall = PromptRecallModel.create()
  let draft = ''
  let caret = 0
  const press = (direction: RecallDirection): string | null => {
    const shown = recall.step({ direction, draft, caret: { start: caret, end: caret }, prompts: () => prompts })
    if (shown !== null) {
      draft = shown
      caret = shown.length
    }
    return shown
  }
  return {
    press,
    escape: () => {
      const restored = recall.escape(draft)
      if (restored !== null) draft = restored
      return restored
    },
    type: (text: string) => {
      draft += text
      caret = draft.length
    },
    caretAt: (offset: number) => {
      caret = offset
    },
    draft: () => draft,
  }
}

describe('prompt recall', () => {
  test('reads human prompts newest first, once each, skipping injected and empty messages', () => {
    const entries = [
      userPrompt('first'),
      userPrompt('injected context', 'goal'),
      { type: 'event', event: { type: 'assistant/message', data: {} } },
      userPrompt('second'),
      userPrompt('first'),
      userPrompt('   '),
      { type: 'transient', event: {} },
    ]
    expect(PromptRecallModel.promptsOf(entries)).toEqual(['first', 'second'])
  })

  test('ArrowUp in an empty composer recalls the newest prompt, then older ones', () => {
    const composer = driver()
    expect(composer.press('older')).toBe('newest')
    expect(composer.press('older')).toBe('middle\nsecond line')
  })

  test('a multi-line recalled prompt lets the caret move between its lines before recalling further', () => {
    const composer = driver()
    composer.press('older')
    composer.press('older')
    expect(composer.press('older')).toBeNull()
    composer.caretAt(2)
    expect(composer.press('older')).toBe('oldest')
    expect(composer.press('older')).toBeNull()
  })

  test('ArrowDown walks forward and past the newest restores the empty draft', () => {
    const composer = driver()
    composer.press('older')
    composer.press('older')
    expect(composer.press('newer')).toBe('newest')
    expect(composer.press('newer')).toBe('')
    expect(composer.press('newer')).toBeNull()
  })

  test('Escape restores the draft recall started from', () => {
    const composer = driver()
    composer.press('older')
    expect(composer.escape()).toBe('')
    expect(composer.draft()).toBe('')
    expect(composer.escape()).toBeNull()
  })

  test('editing a recalled prompt ends recall, so the arrows and Escape keep their ordinary behaviour', () => {
    const composer = driver()
    composer.press('older')
    composer.type(' edited')
    expect(composer.press('older')).toBeNull()
    expect(composer.press('newer')).toBeNull()
    expect(composer.escape()).toBeNull()
    expect(composer.draft()).toBe('newest edited')
  })

  test('a draft with text never starts recall, and ArrowDown alone never does', () => {
    const composer = driver()
    expect(composer.press('newer')).toBeNull()
    composer.type('draft')
    composer.caretAt(0)
    expect(composer.press('older')).toBeNull()
  })

  test('a thread without prompts leaves ArrowUp alone', () => {
    const recall = PromptRecallModel.create()
    expect(recall.step({ direction: 'older', draft: '', caret: { start: 0, end: 0 }, prompts: () => [] })).toBeNull()
  })
})
