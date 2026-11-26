import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')
const trailing = phoneBar.slice(phoneBar.indexOf('data-inbox-phone-bar="trailing"'))

describe('the phone Triage button (council round 13 C1)', () => {
  it('is the kit bar text button: secondary label at 500 with the list-checks glyph, no ink or local sizing', () => {
    const at = trailing.indexOf('data-inbox-phone-triage=""')
    expect(at).toBeGreaterThan(-1)
    const button = trailing.slice(trailing.lastIndexOf('<Button', at), trailing.indexOf('</Button>', at))
    expect(button).toContain('variant="bar"')
    expect(button).not.toContain('variant="ghost"')
    expect(button).toMatch(/<ListChecksIcon aria-hidden \/>\s*\{value\.triage\.label\}\s*$/u)
    // Its own ink, size and padding are gone: the variant owns them.
    expect(button).not.toContain('className=')
    expect('PHONE_TRIAGE' in InboxView).toBe(false)
  })
})

describe('the phone approval card (council round 13 C1)', () => {
  const runs = panel.slice(panel.indexOf('data-inbox-runs=""'), panel.indexOf('</code>', panel.indexOf('data-inbox-runs=""')))

  it('reads "Runs:" inline with its command, as on desktop: no caption line above the command', () => {
    expect(runs).not.toContain('data-inbox-runs-caption')
    expect(runs).toContain("<span data-evidence-label=\"\">{t('runs')}</span>")
    expect('RUNS_INLINE' in InboxView).toBe(false)
    expect('RUNS_CAPTION' in InboxView).toBe(false)
  })

  // Council round 16 C3: the command sits in the kit evidence well (inbox-round16.test.ts).
  it('clamps the whole line in the well, so the command stays inline after "Runs:"', () => {
    expect(runs).toContain('InboxView.WELL_CLAMP_RUNS')
  })
})

describe('the desktop question card (council round 13 C2)', () => {
  it('offers Open in its head seat, so the verb column has no hole', () => {
    const at = panel.indexOf('data-inbox-open-head=""')
    expect(at).toBeGreaterThan(-1)
    const button = panel.slice(panel.lastIndexOf('<Button', at), panel.indexOf('</Button>', at))
    // Council round 16 C2: a quiet ghost, so the answers lead (inbox-round16.test.ts).
    // Council round 14 C3: it reads its open label ("Open thread") in words (inbox-round14.test.ts).
    expect(button).toContain('{openLabel}')
    // Only in the head (a desktop), only for a card whose answers are its verbs.
    expect(panel).toContain("{place === 'head' && openable && answerable ? (")
  })
})
