import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AccountColor } from '../src/account-color.js'

const { of: accountColor, hueOfHex } = AccountColor
import { EFFORT_BAR_COUNT, effortGlyph } from '../src/effort-levels.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

describe('model brand marks', () => {
  it('reads the family from the model id or name, including prefixed account ids', () => {
    const brand = (id: string, name = id): string | undefined => ModelPickerModel.brandFor({ model: { id, name } })
    expect(brand('gpt-6-luna', 'GPT-6 Luna')).toBe('openai')
    expect(brand('o3-mini')).toBe('openai')
    expect(brand('claude-haiku-5-5', 'Claude Haiku 5.5')).toBe('claude')
    expect(brand('gemini-2.5-pro')).toBe('google')
    expect(brand('deepseek/deepseek-v4.1-flash')).toBe('deepseek')
    expect(brand('llama-4-maverick')).toBe('meta')
    expect(brand('qwen3-max')).toBe('qwen')
    expect(brand('inclusionai/ling-3.1-flash-1019:free')).toBe('ling')
    expect(brand('kimi-k2-thinking')).toBe('kimi')
    expect(brand('mistral-large-3')).toBe('mistral')
    expect(brand('grok-4-fast')).toBe('grok')
    expect(brand('glm-5')).toBe('zhipu')
    expect(brand('acme-secret-model')).toBeUndefined()
  })
})

describe('composer model chip mark', () => {
  it('opens no tooltip faster than the kit default (400 ms)', () => {
    const fast = readdirSync(new URL('../src/', import.meta.url))
      .filter(name => name.endsWith('.tsx') && !name.includes('.test.'))
      .filter(name => [...readFileSync(new URL(name, new URL('../src/', import.meta.url)), 'utf8').matchAll(/delayDuration=\{(\d+)\}/gu)].some(match => Number(match[1]) < 400))
    expect(fast).toEqual([])
  })

  it('leads with the family mark of the model in use, read from its catalog name, and none for an unknown family', () => {
    const codex = { id: 'codex', name: 'Codex', models: [{ id: 'm-1', name: 'GPT-6 Luna' }] }
    expect(ModelPickerModel.triggerBrand({ groups: [codex], current: { provider: 'codex', model: 'm-1' } })).toBe('openai')
    expect(ModelPickerModel.triggerBrand({ groups: [], current: { provider: 'claude', model: 'claude-haiku-5-5' } })).toBe('claude')
    expect(ModelPickerModel.triggerBrand({ groups: [codex], current: { provider: 'acme', model: 'acme-secret' } })).toBeUndefined()
    expect(ModelPickerModel.triggerBrand({ groups: [codex], current: null })).toBeUndefined()
  })
})

describe('account colours', () => {
  it('uses the account accent when it is a full hex colour and a stable hue otherwise', () => {
    // Round 3 R9: the accent sets the dot's hue; the dot's lightness is the picker's, for contrast in both schemes.
    expect(accountColor({ accentColor: '#10A37F', instanceId: 'codex_alex' }).hue).toBe(Math.round(hueOfHex('#10A37F')))
    expect(accountColor({ accentColor: '', instanceId: 'codex_alex' })).toEqual(accountColor({ instanceId: 'codex_alex' }))
    expect(accountColor({ instanceId: 'codex_alex1' })).not.toEqual(accountColor({ instanceId: 'codex_alex2' }))
  })
})

describe('effort glyphs', () => {
  it('fills more bars and warms the hue as effort rises', () => {
    expect(effortGlyph({ index: 0, total: 6 })).toEqual({ filled: 1, tone: 'muted' })
    expect(effortGlyph({ index: 3, total: 6 })).toEqual({ filled: 4, tone: 'success' })
    expect(effortGlyph({ index: 5, total: 6 })).toEqual({ filled: 6, tone: 'warning' })
  })

  it('never asks for more bars than the glyph has, and stays neutral without levels', () => {
    expect(effortGlyph({ index: 9, total: 3 }).filled).toBeLessThanOrEqual(EFFORT_BAR_COUNT)
    expect(effortGlyph({ index: 0, total: 0 })).toEqual({ filled: 0, tone: 'muted' })
  })
})

describe('fallback labels', () => {
  it('names a stored rung with the kit display name rather than the account-prefixed id', () => {
    const groups = [
      {
        id: 'opencode-go-alex',
        name: 'OpenCode Go Alex',
        models: [{ id: 'deepseek-v4', name: 'opencode-go-alex/DeepSeek V4' }],
      },
    ]
    expect(ModelPickerModel.fallbackLabel(groups, { model: 'deepseek-v4', provider: 'opencode-go-alex' })).toEqual({
      effort: undefined,
      model: 'deepseek-v4',
      provider: 'OpenCode Go Alex',
    })
    expect(ModelPickerModel.fallbackLabel(groups, { model: 'gone', provider: 'gone-provider' })).toEqual({
      effort: undefined,
      model: 'gone',
      provider: 'gone-provider',
    })
  })
})
