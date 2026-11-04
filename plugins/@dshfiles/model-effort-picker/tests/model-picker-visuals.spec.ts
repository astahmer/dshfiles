import { describe, expect, it } from 'vitest'
import { ACCOUNT_HUES, accountColor } from '../src/account-color.js'
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

describe('account colours', () => {
  it('uses the account accent when it is a full hex colour and a stable hue otherwise', () => {
    expect(accountColor({ accentColor: '#10A37F', instanceId: 'codex_alex' })).toBe('#10A37F')
    expect(accountColor({ accentColor: '', instanceId: 'codex_alex' })).toBe(accountColor({ instanceId: 'codex_alex' }))
    expect(ACCOUNT_HUES).toContain(accountColor({ instanceId: 'commandcode_work_1' }))
    expect(accountColor({ instanceId: 'codex_alex1' })).not.toBe(accountColor({ instanceId: 'codex_alex2' }))
  })
})

describe('account tags', () => {
  it('drops the service name when the remainder still identifies the account', () => {
    expect(ModelPickerModel.accountTag({ name: 'OpenCode Go Alex', provider: 'OpenCode Go' })).toBe('Alex')
    expect(ModelPickerModel.accountTag({ name: 'Codex Alex2', provider: 'Codex' })).toBe('Alex2')
    expect(ModelPickerModel.accountTag({ name: 'ClaudeWork', provider: 'Claude' })).toBe('ClaudeWork')
  })

  it('keeps the account identifiable when the service prefix leaves an ordinal', () => {
    expect(ModelPickerModel.accountTag({ name: 'GitHub Copilot 1', provider: 'GitHub Copilot' })).toBe('#1')
    expect(ModelPickerModel.accountTag({ name: 'Any Account', provider: undefined })).toBe('Any Account')
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
  it('names a stored rung with its catalog name rather than the account-prefixed id', () => {
    const groups = [
      {
        id: 'opencode-go-alex',
        name: 'OpenCode Go Alex',
        models: [{ id: 'deepseek-v4', name: 'opencode-go-alex/DeepSeek V4' }],
      },
    ]
    expect(ModelPickerModel.fallbackLabel(groups, { model: 'deepseek-v4', provider: 'opencode-go-alex' })).toEqual({
      effort: undefined,
      model: 'DeepSeek V4',
      provider: 'OpenCode Go Alex',
    })
    expect(ModelPickerModel.fallbackLabel(groups, { model: 'gone', provider: 'gone-provider' })).toEqual({
      effort: undefined,
      model: 'gone',
      provider: 'gone-provider',
    })
  })
})
