import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { QuestionKeys } from '../src/question-keys.ts'

const press = (key: string, modifiers: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; isComposing: boolean }> = {}) => ({
  key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers,
})

describe('keyboard answering', () => {
  test('the recommended option takes focus, unless one is already chosen', () => {
    const options = [{ label: 'One flat list' }, { label: 'Grouped by plugin (Recommended)' }]
    const recommended = (label: string) => label.endsWith('(Recommended)')
    expect(QuestionKeys.initialOption(options, [], recommended)).toBe(1)
    expect(QuestionKeys.initialOption(options, ['One flat list'], recommended)).toBe(0)
    expect(QuestionKeys.initialOption([{ label: 'A' }, { label: 'B' }], [], recommended)).toBe(0)
    expect(QuestionKeys.initialOption([], [], recommended)).toBeUndefined()
  })

  test('digits 1-9 name options; modified keys and digits past the list choose nothing', () => {
    expect(QuestionKeys.digitOption(press('2'), 2)).toBe(1)
    expect(QuestionKeys.digitOption(press('1'), 2)).toBe(0)
    expect(QuestionKeys.digitOption(press('3'), 2)).toBeUndefined()
    expect(QuestionKeys.digitOption(press('0'), 9)).toBeUndefined()
    expect(QuestionKeys.digitOption(press('2', { metaKey: true }), 2)).toBeUndefined()
    expect(QuestionKeys.digitOption(press('2', { isComposing: true }), 2)).toBeUndefined()
  })

  test('the card takes focus only from the body, itself or the composer it replaced', () => {
    const body = 'body'
    const inside = 'composer editor'
    const elsewhere = 'sidebar search'
    const seat = { contains: (node: string) => node === inside }
    expect(QuestionKeys.mayTakeFocus(body, { body, within: [seat] })).toBe(true)
    expect(QuestionKeys.mayTakeFocus(null, { body, within: [seat] })).toBe(true)
    expect(QuestionKeys.mayTakeFocus(inside, { body, within: [seat] })).toBe(true)
    expect(QuestionKeys.mayTakeFocus(elsewhere, { body, within: [seat, null] })).toBe(false)
  })

  // The native card wires these: it focuses at mount, handles digits at card level and gives focus back when it leaves.
  test('the question card wires focus at mount, digits at card level and the composer on leave', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/native/QuestionComposer.tsx'), 'utf8')
    expect(source).toMatch(/QuestionKeys\.initialOption\(/)
    expect(source).toMatch(/QuestionKeys\.digitOption\(/)
    expect(source).toMatch(/QuestionKeys\.focusComposer\(/)
    expect(source).toMatch(/data-option-index=/)
  })
})
