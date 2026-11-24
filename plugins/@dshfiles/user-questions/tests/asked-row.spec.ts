import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { askedRowView, type AskedLabel } from '../src/asked-row-view.ts'

const labels = { 'row.asked': 'Asked', 'row.show': 'Show the question', 'row.inspect': 'Inspect', 'reply.skipped': 'Skipped' } satisfies Record<Parameters<AskedLabel>[0], string>
const t: AskedLabel = key => labels[key]
const optionLabel = (label: string) => label.replace(/\s*\(Recommended\)$/, '')
const args = JSON.stringify({
  questions: [{ id: 'go', header: 'Proceed', question: 'Ship the **release notes** now?', options: [{ label: 'Ship now (Recommended)' }, { label: 'Wait' }] }],
})

describe('the ask_user_question transcript row', () => {
  // F22: a pending call drew `Ask question · {"questions":[{"id":"go",…` in a narrow pane.
  test('a pending call reads Asked · header, never its JSON', () => {
    for (const argsRaw of [undefined, '{"questions":[{"id":"go","header":"Pro', args]) {
      const view = askedRowView({ argsRaw, answers: undefined, cancelled: false, t, optionLabel })
      expect(view.title).not.toMatch(/[{"]/)
      expect(view.title).not.toMatch(/waiting|Answer\b/)
    }
    expect(askedRowView({ argsRaw: args, answers: undefined, cancelled: false, t, optionLabel }).title).toBe('Asked · Proceed')
  })

  test('an answered call adds the answer, without the recommendation suffix', () => {
    const view = askedRowView({ argsRaw: args, answers: [{ id: 'go', selected: ['Ship now (Recommended)'] }], cancelled: false, t, optionLabel })
    expect(view.title).toBe('Asked · Proceed · Ship now')
    expect(view.questions).toEqual([{ question: 'Ship the release notes now?', answer: 'Ship now' }])
  })

  test('a skipped or dismissed question says Skipped; a question without a header uses its text', () => {
    expect(askedRowView({ argsRaw: args, answers: [{ id: 'go', selected: [] }], cancelled: false, t, optionLabel }).title).toBe('Asked · Proceed · Skipped')
    expect(askedRowView({ argsRaw: args, answers: undefined, cancelled: true, t, optionLabel }).title).toBe('Asked · Proceed · Skipped')
    const bare = JSON.stringify({ questions: [{ id: 'q', question: 'Keep the old maps?' }] })
    expect(askedRowView({ argsRaw: bare, answers: [{ id: 'q', selected: [], custom: 'Only the 2025 ones' }], cancelled: false, t, optionLabel }).title)
      .toBe('Asked · Keep the old maps? · Only the 2025 ones')
  })

  test('the plugin replaces core\'s keyed row the way thread-sidebar replaces subagent', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/native/index.ts'), 'utf8')
    expect(source).toMatch(/key: 'ask_user_question',\s*registrant: '@dshfiles\/user-questions',\s*priority: -1000/)
  })
})
