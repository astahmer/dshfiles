import { readFileSync } from 'node:fs'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'
import { INBOX_CHIP } from './triage-stage.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const MINUTE = 60_000

describe('phone Inbox cards: one meta grammar (council round 19 C1)', () => {
  it('prints a compact age on a touch screen, so it fits beside the head pill', () => {
    const now = 10 * 24 * 60 * MINUTE
    expect(InboxView.headAge(now - 20_000, now, true)).toBe('now')
    expect(InboxView.headAge(now - 3 * MINUTE, now, true)).toBe('3m')
    expect(InboxView.headAge(now - 2 * 60 * MINUTE, now, true)).toBe('2h')
    expect(InboxView.headAge(now - 3 * 24 * 60 * MINUTE, now, true)).toBe('3d')
    // A desktop card keeps its worded age.
    expect(InboxView.headAge(now - 3 * MINUTE, now, false)).toBe('3 min ago')
  })

  it('gives every card head the age: [mark] project · kind · age', () => {
    expect(panel).toMatch(/<AttentionMeta\s[^>]*project=\{head\.project\}\s+kind=\{head\.kind\}\s+age=\{InboxView\.headAge\(item\.openedAt, props\.now, phone\)\}/u)
  })
})

describe('the phone head pill breathes (council round 19 C1)', () => {
  const merged = cn(INBOX_CHIP, cn('dshx:shrink', InboxView.HEAD_VERB))

  it('is drawn 36pt tall on a touch screen (28px on a desktop), so the 52pt head has 8pt around it', () => {
    expect(merged).toContain('dshx:pointer-coarse:h-9')
    expect(merged).not.toContain('dshx:pointer-coarse:h-11')
    expect(merged).toContain('dshx:h-7')
  })

  it('keeps a 44pt hit area: a pseudo-element 4pt above and below the drawn pill', () => {
    expect(merged).toContain('dshx:pointer-coarse:relative')
    expect(merged).toContain('dshx:pointer-coarse:before:absolute')
    expect(merged).toContain('dshx:pointer-coarse:before:inset-x-0')
    expect(merged).toContain('dshx:pointer-coarse:before:-inset-y-1')
  })
})
