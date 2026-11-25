// @vitest-environment node
import { readFileSync } from 'node:fs'
import { BotIcon, CpuIcon, KeyboardIcon, PaletteIcon, PlugIcon, ShieldIcon, SlidersHorizontalIcon } from '@dshfiles/plugin-ui/icons'
import { PaletteMath, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'
import { SettingsIcons } from './settings-icons.js'

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
  pages: ['Capabilities hub', 'Component gallery', 'Plugin guide'],
} as const satisfies Readonly<Record<string, readonly string[]>>

const channel = (hex: string, index: number): number => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
const mixHex = (top: string, under: string, weight: number): string =>
  `#${[0, 1, 2].map(index => Math.round(channel(top, index) * weight + channel(under, index) * (1 - weight)).toString(16).padStart(2, '0')).join('')}`

/** A tone's colour in one scheme: an identity step from the kit's roles, the secondary ink, or their sRGB mix. */
const toneHex = (tone: string, scheme: 'light' | 'dark'): string => {
  const selector = scheme === 'light' ? ':root {' : 'body[data-ds-dark-theme] {'
  const block = roles.slice(roles.indexOf(selector), roles.indexOf('}', roles.indexOf(selector)))
  const identity = (step: string): string => {
    const match = new RegExp(`--dshx-identity-${step}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`, 'u').exec(block)
    if (match === null) throw new Error(`identity-${step} missing`)
    return PaletteMath.toHex({ l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) })
  }
  const muted = PaletteMath.standaloneColours(scheme).muted
  if (tone === 'var(--dsw-alias-label-secondary)') return muted
  const plain = /^var\(--dshx-identity-(\d)\)$/u.exec(tone)
  if (plain !== null) return identity(plain[1] ?? '')
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

  it('tones each group by the identity ramp: General sky, Models violet, Agents rose, Tools orange, Security slate, Plugins teal', () => {
    expect(SettingsIcons.toneOf('general')).toBe('var(--dshx-identity-7)')
    expect(SettingsIcons.toneOf('models')).toBe('var(--dshx-identity-2)')
    expect(SettingsIcons.toneOf('agents')).toBe('var(--dshx-identity-4)')
    expect(SettingsIcons.toneOf('tools')).toBe('var(--dshx-identity-3)')
    expect(SettingsIcons.toneOf('security')).toMatch(/^color-mix\(in srgb, var\(--dshx-identity-7\)/u)
    expect(SettingsIcons.toneOf('plugins')).toBe('var(--dshx-identity-1)')
    expect(SettingsIcons.toneOf('pages')).toBe('var(--dsw-alias-label-secondary)')
    // Neighbouring named groups never share a tone.
    const named = ['general', 'models', 'agents', 'tools', 'projects'] as const
    expect(new Set(named.map(group => SettingsIcons.toneOf(group))).size).toBe(named.length)
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
        if (tone === 'var(--dsw-alias-label-secondary)' || tone.startsWith('color-mix')) continue
        // 20° or more from the status hues (danger 25, warning 80, success 150, accent 270), as the role declares it.
        const step = /identity-(\d)/u.exec(tone)?.[1] ?? ''
        const h = Number(new RegExp(`--dshx-identity-${step}: oklch\\([\\d.]+ [\\d.]+ ([\\d.]+)\\)`, 'u').exec(roles)?.[1])
        for (const status of [25, 80, 150, 270]) expect(Math.min(Math.abs(h - status), 360 - Math.abs(h - status)), `${scheme} ${group}`).toBeGreaterThanOrEqual(20)
      }
    }
  })
})
