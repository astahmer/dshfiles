import { describe, expect, it } from 'vitest'
import { AccountColor } from '@dshfiles/ai-accounts/account-color'

const { accents: accountAccents, of: accountColor, DARK: DOT_DARK, LIGHT: DOT_LIGHT, hueOfHex, luminanceOfOklch } = AccountColor
import { ModelPickerModel } from '../src/model-picker-model.js'

describe('accounts are told apart (council picker N2)', () => {
  it('gives each account of one service its own dot, at least 60° apart in hue (round 3 R9)', () => {
    const accents = accountAccents([
      { instanceId: 'codex_work', kind: 'codex', accentColor: '#10A37F' },
      { instanceId: 'cc1', kind: 'commandcode', accentColor: '#0E7490' },
      { instanceId: 'cc2', kind: 'commandcode', accentColor: '#0E7490' },
      { instanceId: 'cc3', kind: 'commandcode', accentColor: '#0E7490' },
    ])
    const hue = (id: string): number => accents.get(id)?.hue ?? Number.NaN
    // The first account keeps its accent's hue.
    expect(Math.abs(hue('cc1') - Math.round(hueOfHex('#0E7490')))).toBeLessThanOrEqual(1)
    const gap = (x: number, y: number): number => Math.min(Math.abs(x - y), 360 - Math.abs(x - y))
    for (const [x, y] of [
      ['cc1', 'cc2'],
      ['cc1', 'cc3'],
      ['cc2', 'cc3'],
    ] as const)
      expect(gap(hue(x), hue(y))).toBeGreaterThanOrEqual(60)
    // Six accounts of one service: every pair still 60° apart.
    const six = accountAccents(['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ instanceId: id, kind: 'k', accentColor: '#0E7490' })))
    const hues = [...six.values()].map(accent => accent.hue)
    for (const [i, x] of hues.entries()) for (const y of hues.slice(i + 1)) expect(gap(x, y)).toBeGreaterThanOrEqual(60)
  })

  it('holds every dot at 3:1 or more on the selected wash in both schemes, at any hue', () => {
    const contrast = (x: number, y: number): number => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    const lightWash = luminanceOfOklch({ l: 0.935, c: 0.004, h: 80 })
    const darkWash = luminanceOfOklch({ l: 0.3, c: 0.006, h: 60 })
    for (let h = 0; h < 360; h += 5) {
      expect([h, contrast(luminanceOfOklch({ ...DOT_LIGHT, h }), lightWash) >= 3]).toEqual([h, true])
      expect([h, contrast(luminanceOfOklch({ ...DOT_DARK, h }), darkWash) >= 3]).toEqual([h, true])
    }
    const accent = accountColor({ instanceId: 'x' })
    expect(accent.light).toMatch(/^oklch\(0\.52 0\.12 \d+\)$/u)
    expect(accent.dark).toMatch(/^oklch\(0\.76 0\.11 \d+\)$/u)
  })

  it('tags every account the same short way everywhere: its badge, else its initials with the number kept', () => {
    expect(ModelPickerModel.accountTag({ name: 'Command Code 2' })).toBe('CC2')
    expect(ModelPickerModel.accountTag({ name: 'Codex 1' })).toBe('C1')
    expect(ModelPickerModel.accountTag({ name: 'GitHub Copilot 1' })).toBe('GC1')
    expect(ModelPickerModel.accountTag({ name: 'Command Code 2', badge: 'OPS' })).toBe('OPS')
    expect(ModelPickerModel.accountTag({ name: 'Command Code 2', badge: ' ' })).toBe('CC2')
  })

  it('names the off-default account in the trigger with the same tag', () => {
    const groups = [
      { id: 'cc1', name: 'Command Code 1', models: [{ id: 'gpt-6-luna', name: 'gpt-6-luna' }] },
      { id: 'cc2', name: 'Command Code 2', models: [{ id: 'gpt-6-luna', name: 'gpt-6-luna' }] },
    ]
    expect(ModelPickerModel.triggerLabel({ groups, current: { provider: 'cc2', model: 'gpt-6-luna' } })?.providerTag).toBe('CC2')
  })
})
