// @vitest-environment node
import { readFileSync } from 'node:fs'
import { BotIcon, CpuIcon, KeyboardIcon, PaletteIcon, PlugIcon, ShieldIcon, SlidersHorizontalIcon } from '@dshfiles/plugin-ui/icons'
import { PaletteMath, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'
import { SettingsIcons } from './settings-icons.js'

const icons = readFileSync(new URL('./settings-icons.tsx', import.meta.url), 'utf8')
const roles = readFileSync(new URL('../../plugin-ui/src/color-roles.css', import.meta.url), 'utf8')

describe('SettingsIcons (round five B5, B6)', () => {
  it('names a category by what it holds, and falls back to its group', () => {
    expect(SettingsIcons.glyphOf({ label: 'General', group: 'general' })).toBe(SlidersHorizontalIcon)
    expect(SettingsIcons.glyphOf({ label: 'Appearance', group: 'general' })).toBe(PaletteIcon)
    expect(SettingsIcons.glyphOf({ label: 'Keyboard shortcuts', group: 'general' })).toBe(KeyboardIcon)
    expect(SettingsIcons.glyphOf({ label: 'Model picker', group: 'models' })).toBe(CpuIcon)
    expect(SettingsIcons.glyphOf({ label: 'Agent presets', group: 'agents' })).toBe(BotIcon)
    expect(SettingsIcons.glyphOf({ label: 'MCP endpoint', group: 'tools' })).toBe(PlugIcon)
    expect(SettingsIcons.glyphOf({ label: 'Zork', group: 'security' })).toBe(ShieldIcon)
  })

  it('draws every tile glyph at 3:1 or more on its 14% tile over the page, in both schemes, and never in a status hue', () => {
    const tones = [...new Set([...icons.matchAll(/dshx:text-identity-(\d)'/gu)].map(match => Number(match[1])))]
    expect(tones.length).toBeGreaterThan(3)
    for (const [scheme, selector] of [
      ['light', ':root {'],
      ['dark', 'body[data-ds-dark-theme] {'],
    ] as const) {
      const block = roles.slice(roles.indexOf(selector), roles.indexOf('}', roles.indexOf(selector)))
      const page = PaletteMath.standaloneColours(scheme).bg
      for (const tone of tones) {
        const match = new RegExp(`--dshx-identity-${String(tone)}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`, 'u').exec(block)
        const glyph: Oklch = { l: Number(match?.[1]), c: Number(match?.[2]), h: Number(match?.[3]) }
        // The tile is the tone at 14% composited over the page in sRGB.
        const [pageHex, toneHex] = [page, PaletteMath.toHex(glyph)]
        const channel = (hex: string, index: number): number => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
        const tileHex = `#${[0, 1, 2].map(index => Math.round(channel(pageHex, index) * 0.86 + channel(toneHex, index) * 0.14).toString(16).padStart(2, '0')).join('')}`
        const ratio = PaletteMath.contrastRatio(glyph, PaletteMath.hexToOklch(tileHex))
        expect(ratio, `${scheme} identity-${String(tone)}`).toBeGreaterThanOrEqual(3)
        // 25° or more from the status hues (danger 25, warning 80, success 150, accent 270).
        for (const status of [25, 80, 150, 270]) expect(Math.min(Math.abs(glyph.h - status), 360 - Math.abs(glyph.h - status))).toBeGreaterThanOrEqual(20)
      }
    }
  })
})
