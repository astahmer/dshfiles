import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root; DESIGN.md sits at the repository root.
const design = readFileSync(join(process.cwd(), '../../../DESIGN.md'), 'utf8')
const manifest = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
const exports = (subpath: string): boolean => manifest.includes(`"./${subpath}": {`)

describe('DESIGN.md and the kit agree (round four R8-R15)', () => {
  it('names only kit modules the package exports', () => {
    const named = [...design.matchAll(/@dshfiles\/plugin-ui\/((?:lib|components)\/[\w-]+)/gu)].map(match => match[1] ?? '')
    expect(named).toEqual(expect.arrayContaining(['lib/host-connection', 'lib/error-copy']))
    for (const path of named) {
      const exported = exports(path) || (path.startsWith('components/') && exports('components/*'))
      expect(exported, path).toBe(true)
    }
  })

  it('carries the connection, focus ring, phone hit area and error copy rules', () => {
    for (const text of [
      '## Connection, loading and errors',
      '**Focus ring.**',
      '**Announcements.**',
      '**Waiting on you is Needs you, whatever asks.**',
      '`dshx-hit-44`',
      'a faint\nfocus ring (`ring-ring/50`)',
      'a transport failure or an error code echoed to the user',
    ])
      expect(design).toContain(text)
  })

  it('records the round-five tint rung, project mark, data ramp, surface steps, spacing and compound focus rules', () => {
    for (const text of [
      '**Tint rung.**',
      '`variant="attention"`',
      '`bg-selected-wash`',
      '`ProjectMark`',
      'The data ramp never starts with the accent',
      '**Surface steps.**',
      "  stack: '16px'\n  section: '20px'\n  page: '24px'",
      'padding 24px, 12px below 28rem',
      '**Compound fields.**',
      '`bg-scrim`',
    ])
      expect(design, text).toContain(text)
  })

  it('records the second council pass: selection marker, attention washes, StatusCount, diff and syntax, chart labels, colour through meaning (round five A8)', () => {
    for (const text of [
      '`selected-marker`',
      '`font-selected`',
      '`bg-wash-needs-you`',
      '`bg-wash-failed`',
      'Attention outranks selection',
      '`StatusCount`',
      '**Diff and syntax.**',
      'one syntax pair',
      '**Chart labels.**',
      '**Colour through meaning.**',
      "  wash-needs-you: '#e1e9ff'",
      "  wash-failed-dark: '#311d1b'",
    ])
      expect(design, text).toContain(text)
  })

  it('records the third council pass: neutral selection, nav identity, page container, tabs, one field look, DiffStat, phone status (council round 3 A9)', () => {
    for (const text of [
      "  selected-wash: '#ebe9e6'",
      "  selected-wash-dark: '#2a2725'",
      "  wash-needs-you-band-dark: '#242b3d'",
      "  primary-dark: '#dad7d3'",
      'Indigo fills mean attention only',
      '`selected-card`',
      '**Navigation identity.**',
      '`nav-tone-<id>`',
      '`width="lane"`',
      '1080px',
      '920px',
      '**Tabs — the rule.**',
      '**Fields — one look.**',
      '`UnitInput`',
      '`select-look`',
      '`@dshfiles/plugin-ui/components/diff-stat`',
      '`surface-dialog`',
      '44px top-bar status button',
      'Transcript measure: one 680px column',
      '`ToolCard` `kind`',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass.
    expect(design).not.toContain('No underline tabs\non pages')
    expect(design).not.toContain('Pages fill their pane (no centred max-width column)')
    expect(design).not.toContain('prose caps at 34em')
    expect(design).not.toContain('a quiet low-chroma\n   accent wash')
  })

  it('records the fourth council pass: one Settings column, rail surface, nav tones, attention badge, heading, phone dock (council round 4 A6)', () => {
    for (const text of [
      '**One Settings navigation.**',
      '**Rail surface.**',
      '**Nav tone constraints**',
      '**Attention badge.**',
      '`AttentionBadge`',
      '`--dshx-badge-ring`',
      '15/20 (`text-heading`)',
      '**Phone dock.**',
      'never over text',
      "  primary: '#312d29'",
      "  surface-dialog-dark: '#292624'",
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: the rail's tones are no longer borrowed from the identity ramp.
    expect(design).not.toContain('Threads identity-7, Inbox 2')
  })

  it('records the fifth council pass: two frames, one control height, surface roles, active-tab tone, phone Settings drill-down (council round 5 A7)', () => {
    for (const text of [
      '**Two page frames, not four widths.**',
      '**One control height.**',
      '`--dshx-control-h`',
      "  control-h: '32px'",
      '**Two surface roles**',
      '`dshx:surface-nav`',
      '**Active destination tab.**',
      '`text-nav-<id>`',
      '**Phone Settings is a drill-down.**',
      '`DisclosureTrigger`',
      '`dshx:disclosure`',
      '`@dshfiles/plugin-ui/lib/format-clock-time`',
      '`formatClockTime`',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: the 920px lane and 28px buttons beside 32px fields.
    expect(design).not.toContain('920px lane')
    expect(design).not.toMatch(/button-(primary|outline):\n(?:    .*\n)*?    height: '28px'/u)
  })

  it('records the sixth council pass: ink selection marker, field boundary, 960 lane, dark layering, prompt fill (council round 6 A8)', () => {
    for (const text of [
      'a 2px ink bar,\n   `--dsw-alias-label-primary`',
      '**Field boundary contrast.**',
      '`--dshx-field-border`',
      "  field-border: '#88827d'",
      "  field-border-dark: '#76706c'",
      '960px once the pane is 1280px or wider',
      'the cap is the content box',
      '**dark layering**',
      "  surface-nav-dark: '#1e1b19'",
      '**Prompt fill.**',
      "  prompt-fill: '#ecf5fa'",
      "  prompt-fill-dark: '#1a252a'",
      '`--dshx-ready-mark`',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: the selection marker no longer carries the accent.
    expect(design).not.toContain('a 2px accent bar inset on its leading edge')
  })
})
