import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ThreadTabTitle } from './thread-tab-title.js'

const untitled = 'Untitled thread'

describe('a thread tab title (council round 22, item 7)', () => {
  it('names a subagent tab with the description its parent gave it, as the header, the list and the phone do', () => {
    const child = {
      title: 'Check how credit notes round',
      displayTitle: 'Check how credit notes round',
      blank: false,
      projectionValues: { subagent: { mode: 'continuable', label: '  Check credit note rounding ', seq: 3 } },
    }
    expect(ThreadTabTitle.of(child, untitled)).toBe('Check credit note rounding')
  })

  it('keeps the title of a root thread and of a child with a blank label', () => {
    expect(ThreadTabTitle.of({ title: 'Fix invoice tax rounding', displayTitle: 'Fix invoice tax rounding', blank: false }, untitled)).toBe('Fix invoice tax rounding')
    expect(ThreadTabTitle.of({ displayTitle: 'Audit', blank: false, projectionValues: { subagent: { label: '   ' } } }, untitled)).toBe('Audit')
  })

  it('reads Untitled for a missing or blank thread', () => {
    expect(ThreadTabTitle.of(undefined, untitled)).toBe(untitled)
    expect(ThreadTabTitle.of({ displayTitle: '', blank: true }, untitled)).toBe(untitled)
  })

  it('is the rule the tab strip uses', () => {
    const client = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'client.tsx'), 'utf8')
    expect(client).toContain("const title = ThreadTabTitle.of(session, translate('untitledThread'))")
  })
})
