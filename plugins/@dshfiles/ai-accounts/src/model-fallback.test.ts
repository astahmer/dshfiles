import { describe, expect, it } from 'vitest'
import { ModelFallbackModel } from './model-fallback.js'

const codexWork = { provider: 'codex-work', model: 'gpt-6' }
const codexAlt = { provider: 'codex-alt', model: 'gpt-6', reasoningEffort: 'high' }
const claude = { provider: 'claude-work', model: 'claude-opus-5-5' }
const opencode = { provider: 'opencode-go', model: 'glm-5.3' }
const chain = [codexWork, codexAlt, claude, opencode]

const next = (input: { readonly current: { provider: string; model: string }; readonly tried?: readonly string[]; readonly unavailable?: readonly string[] }) =>
  ModelFallbackModel.remainingFallbacks({
    chain,
    current: input.current,
    tried: new Set(input.tried ?? []),
    available: route => !(input.unavailable ?? []).includes(route.provider),
  })[0]

describe('model fallback chain', () => {
  it('walks the routes after the current one across provider kinds', () => {
    expect(next({ current: codexWork })).toEqual(codexAlt)
    expect(next({ current: codexAlt })).toEqual(claude)
    expect(next({ current: claude })).toEqual(opencode)
  })

  it('wraps to the routes before the current one and skips what this turn already tried', () => {
    expect(next({ current: opencode, tried: ['codex-work/gpt-6'] })).toEqual(codexAlt)
    expect(next({ current: opencode, tried: ['codex-work/gpt-6', 'codex-alt/gpt-6', 'claude-work/claude-opus-5-5'] })).toBeUndefined()
  })

  it('starts from the top when the selection is not in the chain', () => {
    expect(next({ current: { provider: 'deepseek', model: 'deepseek-chat' } })).toEqual(codexWork)
  })

  it('skips disabled or cooling routes', () => {
    expect(next({ current: codexWork, unavailable: ['codex-alt', 'claude-work'] })).toEqual(opencode)
  })

  it('prefers the thread chain over the default and keeps one position per route', () => {
    expect(ModelFallbackModel.effectiveChain({ defaultChain: chain, threadChain: null })).toBe(chain)
    expect(ModelFallbackModel.effectiveChain({ defaultChain: chain, threadChain: [] })).toEqual([])
    expect(ModelFallbackModel.normalizeChain([claude, codexWork, { ...claude, reasoningEffort: 'low' }])).toEqual([claude, codexWork])
  })
})
