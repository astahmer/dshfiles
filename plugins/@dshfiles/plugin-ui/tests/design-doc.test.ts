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
      // Council round 10 A2 made the bar a straight pill; it stays the ink.
      'ink pill, `--dsw-alias-label-primary`',
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

  it('records the seventh council pass: ink on states, page title mark, field trigger, short-code wrap, diff bar and dark bands (council round 7 A5)', () => {
    for (const text of [
      '**Indigo is attention, focus and links; every on state is ink.**',
      '`control-on-foreground`',
      'an ink check badge',
      'over a 2px ink bar',
      '**Page title mark.**',
      '`markTone`',
      '**Field trigger.**',
      '`variant="field"`',
      '**Short code on narrow panes.**',
      '12 lines or fewer',
      'Show N unchanged lines',
      // Council round 10 A4 recalibrated the dark bands; they stay their own step in the tone's hue.
      "each band is its own step in the tone's hue",
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: indigo on the active tab bar and on control on states.
    expect(design).not.toContain('**Accent indigo means interaction.**')
    expect(design).not.toContain('a 2px accent bar')
  })

  it('records the eighth council pass: text rung, selected card, off switch, rail tones, Settings rows, code hang (council round 8 A7)', () => {
    for (const text of [
      '**Text rung.**',
      '`variant="attention-text"`',
      '`variant="danger-text"`',
      'the card keeps its own surface',
      'an ink check badge',
      '**Off switch.**',
      'Work orange 52, Observe lime 118, Land teal 180, Threads blue 235, Knowledge violet 305, Agents rose 350',
      'Inbox is the attention destination',
      '40° or more from every other',
      '**Settings rows.**',
      '`settings-row`',
      '`settings-heading`',
      '`settings-label`',
      '`settings-description`',
      '**Wrapped code.**',
      '`--dshx-line-indent`',
      '`@dshfiles/plugin-ui/lib/code-indent`',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: the round-four rail hues and the washed chosen card.
    expect(design).not.toContain('Threads cyan-blue 220')
    expect(design).not.toContain('Inbox violet 297')
    expect(design).not.toContain('Threads at hue 235 or less')
    expect(design).not.toContain('instead: the wash, a 2px ink ring edge')
  })

  it('records the ninth council pass: selected-place tile, dark on state, toolbar fields, form frame, phone Inbox head, Triage (council round 9 A6)', () => {
    for (const text of [
      '**Selected-place tile: a selected place carries its tone.**',
      '`PlaceGlyph`',
      '`dshx:place-seat`',
      'Page `h1` marks stay glyph-only',
      '**Dark on state.**',
      "  control-on-dark: '#c6c3c1'",
      'a 1.5px edge in the ink at 80%',
      '**Toolbar fields.**',
      '`size="field"`',
      '**Form frame.**',
      '`PAGE_FRAME_CLASS.form`',
      '176px minimum width',
      'Rows sit on the 720 form frame',
      '**Phone Inbox head.**',
      'never cut for metadata',
      '**Triage**',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: the 2px pure-ink card edge, the untiled active tab and the 880 Settings frame.
    expect(design).not.toContain('a 2px ink ring edge')
    expect(design).not.toContain('the tab takes no tile or tint')
    expect(design).not.toContain('Rows stay on the 880 frame')
  })

  it('records the tenth council pass: quiet triggers, the pill marker, one segment, one keycap, Settings headings, dark diff, chart text (council round 10 A9)', () => {
    for (const text of [
      '**Quiet triggers**',
      '`triggerLook`',
      '`bg-trigger-fill`',
      '**Filter row.**',
      'one scope button',
      'a straight\n   3 x 16px ink pill',
      '**No bar beside a place tile.**',
      '**One selected segment**',
      '`segment-thumb`',
      '`SegmentLabel`',
      '**One shortcut chip.**',
      '`--dshx-kbd-font`',
      '18/24 (`settings-heading`)',
      '40px above and 12px below',
      'calm lines at L 0.25',
      'L 0.34, chroma 0.075',
      '`#dad7d3`, measured',
      'no chart text is under 12px',
      '**Backlog status glyphs**',
      'a ring holding a half-disc',
      '**Spend map breakdown.**',
      '`picker="segments"`',
      '◆ 2 · ✕ 1',
      '`ArrowDown` in a 28px round seat',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: the bending inset bar, the all-edged filter row, the two-scheme keycap, the 15/32 Settings
    // heading, the brighter dark diff bands and 11px chart labels.
    expect(design).not.toContain('inset on its leading edge, which follows a rounded row')
    expect(design).not.toContain('A filter row never mixes the field edge')
    expect(design).not.toContain('a faint light cap (`oklch(1 0 0 / 0.08)`) with a 12% edge')
    expect(design).not.toContain('15/20 at 600, 32px above')
    expect(design).not.toContain('L 0.27 at chroma 0.045')
    expect(design).not.toContain('kbd hints, graph and chart labels')
  })

  it('records the eleventh council pass: no pill beside a glyph, the trigger hairline, the typeable combobox, the light diff, the dense checkbox (council round 11 A6)', () => {
    for (const text of [
      '**No bar beside a glyph, tile or mark.**',
      '`LEADING_GLYPH_ATTRIBUTE`',
      '`MARKER_OPT_OUT`',
      '`MARKER_KEEP`',
      'a selected Needs-you or Failed row keeps it',
      'with an ink count of the filters that are on',
      'Assistant prose stops at 36em (about 72 characters',
      'The composer card takes the 3:1 field edge',
      'Only plain-text\n   rows keep the pill',
      'a quiet 1px hairline at rest (`border-border`, `--dsw-alias-border-l2`',
      '**A typeable combobox**',
      '`Input rest="trigger"`',
      'a 16% tint of success and danger',
      'a changed word 34%',
      'capped at L 0.43',
      '`Checkbox size="sm"`',
      'a 12px tick at an absolute 1.5px stroke',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: the transparent trigger edge, the 12% / 20% light diff and the pill a seat gave back.
    expect(design).not.toContain('a transparent 1px edge at rest')
    expect(design).not.toContain('a 12% tint of success and danger')
    expect(design).not.toContain('gives the pill back')
    expect(design).not.toContain('with a tinted dot')
    expect(design).not.toContain('Prose reads at about 66ch')
  })

  it('records the twelfth council pass: the selected edge, verbs on a band, dense checkbox ink, the phone tab bar, Triage, the quiet dock (council round 12 A5)', () => {
    for (const text of [
      '**Selected edge.**',
      '`SELECTED_EDGE`',
      "  selected-edge: '#88827d'",
      "  selected-edge-dark: '#7f7974'",
      '**Verbs on a head band**',
      '`Button band`: 20% at rest, 26% on hover, 32% pressed',
      '`control-on-dense`, `oklch(0.50 0.01 65)`',
      '**Phone tab bar: one neutral pill, colour in the glyph**',
      'Unselected\n    glyphs are the tertiary ink',
      '**Triage** is a worded 44px text button in the top bar',
      'only the editable card\n  keeps the field edge',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: Triage kept out of the top bar, every tab-bar glyph toned at rest, the dock sharing the
    // composer's 3:1 edge.
    expect(design).not.toContain('never in the top bar')
    expect(design).not.toContain('every destination glyph is drawn in its tone at rest')
    expect(design).not.toContain("shares the composer card's two edges")
    expect(design).not.toContain("the composer card's ring as the one shared edge")
  })

  it('records the thirteenth council pass: one tab-bar pill, the edge only where needed, the send seat, one chip, bar text buttons, nice domains (council round 13 A5)', () => {
    for (const text of [
      '**Phone tab bar: one neutral pill, colour in the glyph**',
      'the same neutral selected pill',
      '**Selected edge only where it is needed.**',
      'a row with a place tile',
      '**Composer send.**',
      'a 28px circle (32px on a phone)',
      '**New thread chips: one style.**',
      '32px tall, radius 8, the raised fill, no border',
      '**Bar text buttons.**',
      '`Button variant="bar"`',
      '`control-on-dense`, `oklch(0.50 0.01 65)`',
      '**Nice value domains.**',
      '`.nice()`',
      'a "Share by" segmented',
    ])
      expect(design, text).toContain(text)
    // Retired by this pass: a toned tile on the current phone tab, the edge on place-tile rows, "Breakdown by".
    expect(design).not.toContain('the current one is drawn in its tone on its tile with a 600 label')
    expect(design).not.toContain('a "Breakdown by" segmented')
  })
})
