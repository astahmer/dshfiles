// @vitest-environment node
import { readFileSync } from 'node:fs'
import { BotIcon, CpuIcon, KeyboardIcon, PaletteIcon, PlugIcon, ShieldIcon, SlidersHorizontalIcon } from '@dshfiles/plugin-ui/icons'
import { PaletteMath, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsIcons, SettingsToneMark } from './settings-icons.js'

const roles = readFileSync(new URL('../../plugin-ui/src/color-roles.css', import.meta.url), 'utf8')

/** The Settings column of the web profile, as the round-6 screenshots show it, by group. */
const COLUMN = {
  general: ['General', 'Appearance', 'Keyboard shortcuts', 'Thread list', 'Layout', 'Composer', 'Transcript', 'Editor', 'Archived threads'],
  models: ['AI accounts', 'Models', 'Model picker', 'DeepSeek account'],
  agents: ['Agent definitions', 'Agent presets', 'Subagents', 'Background jobs', 'Memory', 'Agent loop'],
  tools: ['MCP servers', 'MCP endpoint', 'Web search and fetch', 'Jev'],
  projects: ['Projects', 'New thread', 'Thread workspaces', 'Repository history', 'Checks and tests', 'Preview and dev servers', 'Backlog', 'Pull requests', 'Automations'],
  hosts: ['Hosts', 'Network access', 'Thread sharing'],
  security: ['Secrets', 'Policies', 'Shell sandbox', 'Thread cleanup', 'Thread log sharing'],
  notifications: ['Thread notifications'],
  plugins: ['Built-in plugins', 'Installed plugins', 'Plugin Market', 'Plugin updates', 'OpenCode plugins'],
  about: ['Update DSH', 'Getting started', 'Diagnostics'],
  // Plugins is listed here only when no Installed plugins link stands for it (settings-groups.ts › DESTINATION_PAGES).
  pages: ['Capabilities hub'],
  // The thread sidebar's Developer block closes the column (component gallery, plugin guide).
  developer: ['Component gallery', 'Plugin guide'],
} as const satisfies Readonly<Record<string, readonly string[]>>

const channel = (hex: string, index: number): number => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
const mixHex = (top: string, under: string, weight: number): string =>
  `#${[0, 1, 2].map(index => Math.round(channel(top, index) * weight + channel(under, index) * (1 - weight)).toString(16).padStart(2, '0')).join('')}`

/** An identity step of the kit's roles in one scheme, as OKLCH. */
const identityOklch = (step: string, scheme: 'light' | 'dark'): Oklch => {
  const selector = scheme === 'light' ? ':root {' : 'body[data-ds-dark-theme] {'
  const block = roles.slice(roles.indexOf(selector), roles.indexOf('}', roles.indexOf(selector)))
  const match = new RegExp(`--dshx-identity-${step}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`, 'u').exec(block)
  if (match === null) throw new Error(`identity-${step} missing`)
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) }
}

/** `color-mix(in oklch, a P%, b)`: lightness and chroma blend linearly, the hue along the shorter arc. */
const mixOklch = (a: Oklch, b: Oklch, weight: number): Oklch => {
  const delta = ((((b.h - a.h) % 360) + 540) % 360) - 180
  return { l: a.l * weight + b.l * (1 - weight), c: a.c * weight + b.c * (1 - weight), h: (a.h + delta * (1 - weight) + 360) % 360 }
}

/** A two-step OKLCH mix's parts, or undefined for any other tone. */
const oklchMix = (tone: string): { readonly a: string; readonly b: string; readonly weight: number } | undefined => {
  const match = /^color-mix\(in oklch, var\(--dshx-identity-(\d)\) (\d+)%, var\(--dshx-identity-(\d)\)\)$/u.exec(tone)
  return match === null ? undefined : { a: match[1] ?? '', b: match[3] ?? '', weight: Number(match[2]) / 100 }
}

/** A tone's hue: an identity step's, or the hue its OKLCH mix lands on; undefined for the ink and its sRGB mixes. */
const toneHue = (tone: string, scheme: 'light' | 'dark'): number | undefined => {
  const plain = /^var\(--dshx-identity-(\d)\)$/u.exec(tone)
  if (plain !== null) return identityOklch(plain[1] ?? '', scheme).h
  const mix = oklchMix(tone)
  return mix === undefined ? undefined : mixOklch(identityOklch(mix.a, scheme), identityOklch(mix.b, scheme), mix.weight).h
}

/** A tone's colour in one scheme: an identity step from the kit's roles, two steps' OKLCH mix, the secondary ink, or an sRGB mix of a step into it. */
const toneHex = (tone: string, scheme: 'light' | 'dark'): string => {
  const identity = (step: string): string => PaletteMath.toHex(identityOklch(step, scheme))
  const muted = PaletteMath.standaloneColours(scheme).muted
  if (tone === 'var(--dsw-alias-label-secondary)') return muted
  const plain = /^var\(--dshx-identity-(\d)\)$/u.exec(tone)
  if (plain !== null) return identity(plain[1] ?? '')
  const mix = oklchMix(tone)
  if (mix !== undefined) return PaletteMath.toHex(mixOklch(identityOklch(mix.a, scheme), identityOklch(mix.b, scheme), mix.weight))
  const mixed = /^color-mix\(in srgb, var\(--dshx-identity-(\d)\) (\d+)%, var\(--dsw-alias-label-secondary\)\)$/u.exec(tone)
  if (mixed === null) throw new Error(`unreadable tone ${tone}`)
  return mixHex(identity(mixed[1] ?? ''), muted, Number(mixed[2]) / 100)
}

const hue = (hex: string): Oklch => PaletteMath.hexToOklch(hex)

describe('SettingsIcons (round five B5, B6; council round 6 B3, B4)', () => {
  it('names a category by what it holds, and falls back to its group', () => {
    expect(SettingsIcons.glyphOf({ label: 'General', group: 'general' })).toBe(SlidersHorizontalIcon)
    expect(SettingsIcons.glyphOf({ label: 'Appearance', group: 'general' })).toBe(PaletteIcon)
    expect(SettingsIcons.glyphOf({ label: 'Keyboard shortcuts', group: 'general' })).toBe(KeyboardIcon)
    expect(SettingsIcons.glyphOf({ label: 'Models', group: 'models' })).toBe(CpuIcon)
    expect(SettingsIcons.glyphOf({ label: 'Agent definitions', group: 'agents' })).toBe(BotIcon)
    expect(SettingsIcons.glyphOf({ label: 'MCP servers', group: 'tools' })).toBe(PlugIcon)
    expect(SettingsIcons.glyphOf({ label: 'Zork', group: 'security' })).toBe(ShieldIcon)
  })

  it('gives every item of the column its own glyph (no Models / Model picker, MCP servers / endpoint repeats)', () => {
    const seen = new Map<unknown, string>()
    for (const [group, labels] of Object.entries(COLUMN))
      for (const label of labels) {
        const glyph = SettingsIcons.glyphOf({ label, group })
        expect(seen.get(glyph), `${label} repeats the glyph of ${seen.get(glyph) ?? ''}`).toBeUndefined()
        seen.set(glyph, label)
      }
  })

  it('keeps the ramp tones: General sky, Models violet, Agents rose, Tools copper, Plugins teal', () => {
    expect(SettingsIcons.toneOf('general')).toBe('var(--dshx-identity-7)')
    expect(SettingsIcons.toneOf('models')).toBe('var(--dshx-identity-2)')
    expect(SettingsIcons.toneOf('agents')).toBe('var(--dshx-identity-4)')
    expect(SettingsIcons.toneOf('tools')).toBe('var(--dshx-identity-3)')
    expect(SettingsIcons.toneOf('plugins')).toBe('var(--dshx-identity-1)')
  })

  it('tints every group of the column, each in its own tone, neighbours at least 40° apart (council round 8 B4)', () => {
    const groups = Object.keys(COLUMN)
    const tones = groups.map(group => SettingsIcons.toneOf(group))
    // No grey group: every tone is an identity hue, neither the secondary ink nor a step greyed into it.
    for (const [index, tone] of tones.entries()) expect(toneHue(tone, 'light'), `${groups[index] ?? ''}: ${tone}`).toBeDefined()
    // The ramp has ten hues clear of the status hues for twelve groups: a tone repeats only four or more groups away.
    for (const [index, tone] of tones.entries()) {
      const again = tones.indexOf(tone, index + 1)
      if (again !== -1) expect(again - index, `${groups[index] ?? ''} / ${groups[again] ?? ''}`).toBeGreaterThanOrEqual(4)
    }
    expect(new Set(tones).size).toBeGreaterThanOrEqual(10)
    // Groups that stand one after the other in the column read apart: 40° of hue.
    for (const scheme of ['light', 'dark'] as const)
      for (let index = 1; index < groups.length; index += 1) {
        const [before, after] = [toneHue(tones[index - 1] ?? '', scheme), toneHue(tones[index] ?? '', scheme)]
        if (before === undefined || after === undefined) continue
        const apart = Math.min(Math.abs(before - after), 360 - Math.abs(before - after))
        expect(apart, `${scheme} ${groups[index - 1] ?? ''} / ${groups[index] ?? ''}`).toBeGreaterThanOrEqual(40)
      }
  })

  it('draws every glyph at 3:1 on the page and on its 14% tile, in both schemes, and no tinted one in a status hue', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const colours = PaletteMath.standaloneColours(scheme)
      for (const group of Object.keys(COLUMN)) {
        const tone = SettingsIcons.toneOf(group)
        const glyph = toneHex(tone, scheme)
        for (const [surface, ground] of [
          ['page', colours.bg],
          ['nav', colours.panel],
          ['tile', mixHex(glyph, colours.bg, 0.14)],
        ] as const)
          expect(PaletteMath.contrastRatio(hue(glyph), hue(ground)), `${scheme} ${group} on ${surface}`).toBeGreaterThanOrEqual(3)
        // 20° or more from the status hues (danger 25, warning 80, success 150, accent 270), as the role declares it;
        // an OKLCH mix of two steps is held to it too.
        const h = toneHue(tone, scheme)
        if (h === undefined) continue
        for (const status of [25, 80, 150, 270]) expect(Math.min(Math.abs(h - status), 360 - Math.abs(h - status)), `${scheme} ${group}`).toBeGreaterThanOrEqual(20)
      }
    }
  })
})

describe('SettingsToneMark (council round 8 B4)', () => {
  it('draws a page\'s own icon in its group\'s tone, so a Pages or Developer row is never grey', () => {
    const markup = renderToStaticMarkup(
      <SettingsToneMark group="developer">
        <svg data-own-icon="" />
      </SettingsToneMark>,
    )
    expect(markup).toContain('data-settings-glyph="developer"')
    expect(markup).toContain('dshx:text-(--settings-tone)')
    expect(markup).toContain(`--settings-tone:${SettingsIcons.toneOf('developer')}`)
    expect(markup).toContain('data-own-icon')
  })
})

describe('SettingsIcons.pagePlaces (round nine B2)', () => {
  it('gives each Settings page with its own tab the glyph and tone its Settings row carries', () => {
    const places = new Map(SettingsIcons.pagePlaces().map(place => [place.panelId, place]))
    expect(places.get('ai-accounts')?.tone).toBe('var(--dshx-identity-2)')
    expect(places.get('ai-accounts')?.glyph).toBe(SettingsIcons.glyphOf({ label: 'AI accounts', group: 'models' }))
    expect(places.get('plugins')?.tone).toBe('var(--dshx-identity-1)')
    expect(places.get('plugins')?.glyph).not.toBe(SettingsIcons.glyphOf({ label: 'Settings', group: 'general' }))
  })

  it('is provided to the tab strips from the client entry', () => {
    const client = readFileSync(new URL('client.tsx', import.meta.url), 'utf8')
    expect(client).toContain('for (const place of SettingsIcons.pagePlaces()) metadata?.plugin?.add(TabPlaceGlyphs, place)')
  })
})
