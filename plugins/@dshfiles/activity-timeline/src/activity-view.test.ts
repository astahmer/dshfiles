import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ActivityView } from './activity-view.js'

const titles = new Map([['session-7b169f4b-6c28-4725-ae2a-c4c93c2990aa', 'Draft the 0.2 release notes']])
const threadTitle = (sessionId: string): string => titles.get(sessionId) ?? `Thread ${sessionId.slice('session-'.length, 'session-'.length + 8)}`

describe('activity row text', () => {
  it('names the thread instead of printing its id', () => {
    expect(ActivityView.summaryOf('2× status change for session-7b169f4b-6c28-4725-ae2a-c4c93c2990aa', threadTitle)).toBe(
      '2× status change for Draft the 0.2 release notes',
    )
    expect(ActivityView.summaryOf('Turn failed in session-1eb8f1f1-3b82-4d69-b9f2-6a5aad5e2099.', threadTitle)).toBe('Turn failed in Thread 1eb8f1f1.')
  })

  it('prints a pasted Markdown item as plain words', () => {
    expect(ActivityView.summaryOf('You created b:qfr1 Open [guide](https://example.com/guide) and **ship** it', threadTitle)).toBe(
      'You created b:qfr1 Open guide and ship it',
    )
  })
})

describe('activity header chips', () => {
  it('shows a count only when there is something to count, and attention as a tint, never a solid fill', () => {
    expect(ActivityView.headerChips({ retained: 22, attention: 1, duplicates: 0 })).toEqual([
      { id: 'retained', count: 22, tone: 'muted' },
      { id: 'attention', count: 1, tone: 'danger' },
    ])
    expect(ActivityView.headerChips({ retained: 22, attention: 0, duplicates: 3 })).toEqual([
      { id: 'retained', count: 22, tone: 'muted' },
      { id: 'duplicates', count: 3, tone: 'muted' },
    ])
    expect(ActivityView.headerChips(undefined)).toEqual([])
  })
})

describe('activity page copy and chrome', () => {
  const panel = readFileSync(new URL('./panel.tsx', import.meta.url), 'utf8')
  const locales = readFileSync(new URL('./locales.ts', import.meta.url), 'utf8')
  const english = locales.slice(locales.indexOf('const en = {'), locales.indexOf('const zh = {'))

  it('names the toggle and the thread verb in plain words', () => {
    expect(english).toContain("detailed: 'Every event'")
    expect(english).toContain("openSession: 'Open thread'")
    // Values only: a key such as `openSession` is not copy.
    expect(english.match(/'[^'\n]*'/gu)?.join(' ') ?? '').not.toMatch(/condensation|\bSessions?\b/u)
  })

  it('does not repeat the page title as a section heading, fill a chip solid red, or say one thing twice per row', () => {
    expect(panel).not.toMatch(/<PageSection\s+heading=\{t\('title'\)\}/u)
    expect(panel).not.toMatch(/<(?:Badge|Button)\b[^>]*'destructive'/u)
    // The initials tile already says the source; the row has no chip repeating it, and no raw correlation id.
    expect(panel).not.toMatch(/<Badge variant=\{badgeVariant\(item\)\}>|correlation \{item\.correlationId\}/u)
    // What the tile shows by colour and initials stays in the row's accessible name.
    expect(panel).toMatch(/<span className="dshx:sr-only">\{props\.t\(item\.source\)\}<\/span>/u)
    expect(panel).toContain('data-activity-attention=""')
    // The kit heading for a day group is upper case; this page asks for sentence case.
    expect(panel).toContain('dshx:[&_h3]:normal-case')
  })
})
