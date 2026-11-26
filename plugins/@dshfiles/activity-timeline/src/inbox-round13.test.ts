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
    expect(runs).toContain("<span>{t('runs')}</span>")
    expect('RUNS_INLINE' in InboxView).toBe(false)
    expect('RUNS_CAPTION' in InboxView).toBe(false)
  })

  it('keeps the muted block, and clamps and hangs the whole line there, so the command stays inline', () => {
    for (const part of ['dshx:@max-pane-narrow:bg-muted', 'dshx:@max-pane-narrow:rounded-md', 'dshx:@max-pane-narrow:line-clamp-4', 'dshx:@max-pane-narrow:-indent-[2ch]'])
      expect(InboxView.RUNS_BLOCK).toContain(part)
    expect(InboxView.RUNS_BLOCK).not.toContain('dshx:@max-pane-narrow:block')
    for (const part of ['line-clamp', 'indent', 'pl-[2ch]']) expect(InboxView.COMMAND_BLOCK).not.toContain(part)
    expect(InboxView.COMMAND_BLOCK).toContain('dshx:@max-pane-narrow:leading-4.5')
  })
})

describe('the desktop question card (council round 13 C2)', () => {
  it('offers a quiet Open in its head seat, so the verb column has no hole', () => {
    const at = panel.indexOf('data-inbox-open-quiet=""')
    expect(at).toBeGreaterThan(-1)
    const button = panel.slice(panel.lastIndexOf('<Button', at), panel.indexOf('</Button>', at))
    expect(button).toContain('variant="ghost"')
    // Council round 14 C3: it reads its open label ("Open thread") in words (inbox-round14.test.ts).
    expect(button).toContain('{openLabel}')
    // Only in the head (a desktop), only for a card whose answers are its verbs.
    expect(panel).toContain("{place === 'head' && openable && answerable ? (")
  })
})
