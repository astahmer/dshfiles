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

  test('the card takes focus from the body, its seat or a clicked thread row, never from a field being typed in', () => {
    const body = 'body'
    const inside = 'composer editor'
    const row = 'thread row'
    const search = 'sidebar search'
    const seat = { contains: (node: string) => node === inside }
    const typesText = (node: string) => node === search || node === inside
    expect(QuestionKeys.mayTakeFocus(body, { body, within: [seat], typesText })).toBe(true)
    expect(QuestionKeys.mayTakeFocus(null, { body, within: [seat], typesText })).toBe(true)
    expect(QuestionKeys.mayTakeFocus(inside, { body, within: [seat], typesText })).toBe(true)
    // F17: switching threads from the list left focus on the row when the composer seat held a question card.
    expect(QuestionKeys.mayTakeFocus(row, { body, within: [seat, null], typesText })).toBe(true)
    expect(QuestionKeys.mayTakeFocus(search, { body, within: [seat, null], typesText })).toBe(false)
  })

  test('the card listens for the workbench event that shows a kept thread view again', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const workbench = readFileSync(resolve(root, 'workbench/src/kept-thread-views.tsx'), 'utf8')
    expect(workbench).toContain(`shownEvent = '${QuestionKeys.THREAD_VIEW_SHOWN}'`)
    const card = readFileSync(resolve(root, 'user-questions/src/native/QuestionComposer.tsx'), 'utf8')
    expect(card).toMatch(/addEventListener\(QuestionKeys\.THREAD_VIEW_SHOWN/)
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
