import { describe, expect, it } from 'vitest'
import { ThreadAccountModel } from './thread-account-model.js'

const models = [
  { id: 'preferred', name: 'Preferred' },
  { id: 'same', name: 'Same' },
  { id: 'deployment', name: 'Deployment' },
]
const choose = (model: string, defaultModel?: string) =>
  ThreadAccountModel.choose({ current: { provider: 'old', model }, provider: 'new', models, defaultModel })

describe('thread account model choice', () => {
  it('retains the exact advertised model before considering a default', () => {
    expect(choose('same', 'deployment')).toEqual({ model: models[1], strategy: 'same-model' })
  })
  it('uses the configured deployment default when the destination offers it', () => {
    expect(choose('unavailable', 'deployment')).toEqual({ model: models[2], strategy: 'default-model' })
  })
  it('honestly distinguishes adapter/account preference from a configured default', () => {
    expect(choose('unavailable', 'also-unavailable')).toEqual({ model: models[0], strategy: 'preferred-model' })
  })
  it('refuses an empty catalog rather than inventing a target model', () => {
    expect(() => ThreadAccountModel.choose({ current: { provider: 'old', model: 'same' }, provider: 'new', models: [] })).toThrow('no available models')
  })
  it('detects model or effort changes before a confirmation is accepted', () => {
    const selection = { provider: 'new', model: 'same', reasoningEffort: 'high' }
    expect(ThreadAccountModel.same(selection, { ...selection })).toBe(true)
    expect(ThreadAccountModel.same(selection, { ...selection, reasoningEffort: 'low' })).toBe(false)
    expect(ThreadAccountModel.same(selection, { provider: 'new', model: 'other' })).toBe(false)
    expect(ThreadAccountModel.same(selection, { provider: 'other', model: 'same' })).toBe(false)
  })
})

describe('optional compaction recommendation, not eligibility or billing', () => {
  it.each([
    [31_999, null, false],
    [32_000, null, true],
    [15_999, 20_000, false],
    [16_000, 32_000, true],
    [16_000, 64_000, false],
    [100, 128_000, false],
    [Number.NaN, 10_000, false],
  ])('~%s tokens / %s window suggests %s', (tokens, window, expected) => {
    expect(ThreadAccountModel.suggestCompaction(tokens, window)).toBe(expected)
  })
})
