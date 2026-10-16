import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { describe, expect, it } from 'vitest'
import { CODEX_RESERVE_MODEL, shouldUseLunaReserve, withLunaReserve } from './codex-luna-reserve.js'
import { ProviderUsageModel } from './usage.js'

const noCredits = { available: 0, resets: [] }
const WEEK = 604_800
const reserveResponse = (weeklyUsed: number, reserveUsed: number) => ({
  plan_type: 'plus',
  rate_limit: { primary_window: { used_percent: weeklyUsed, limit_window_seconds: WEEK, reset_at: 2_000 } },
  additional_rate_limits: [
    { limit_name: 'codex_other', metered_feature: 'codex_review', rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: WEEK } } },
    {
      limit_name: 'Luna Reserve',
      metered_feature: 'codex_luna_reserve',
      rate_limit: { primary_window: { used_percent: reserveUsed, limit_window_seconds: WEEK, reset_at: 9_000 } },
    },
    'not an object',
  ],
})

describe('Codex Luna Reserve', () => {
  it('adds the reserve as its own window beside the ordinary gauges, and skips unrelated or broken limits', () => {
    const card = ProviderUsageModel.parseCodexUsage(reserveResponse(100, 0), noCredits, 0)
    expect(card.windows).toEqual([
      { label: 'Weekly limit', percentRemaining: 0, resetsAt: 2_000_000 },
      { label: 'Luna Reserve', percentRemaining: 100, resetsAt: 9_000_000, reserve: true },
    ])
  })

  it('keeps fresh ordinary gauges after a reset even when the reserve meter is still reported', () => {
    const card = ProviderUsageModel.parseCodexUsage(reserveResponse(0, 40), noCredits, 0)
    expect(card.windows[0]).toEqual({ label: 'Weekly limit', percentRemaining: 100, resetsAt: 2_000_000 })
    expect(shouldUseLunaReserve(card, 0)).toBe(false)
  })

  it('routes to the reserve only while the ordinary limit is spent, unreset, and the reserve lasts', () => {
    const spent = ProviderUsageModel.parseCodexUsage(reserveResponse(100, 30), noCredits, 0)
    expect(shouldUseLunaReserve(spent, 1_000)).toBe(true)
    expect(shouldUseLunaReserve(spent, 2_000_001)).toBe(false)
    expect(shouldUseLunaReserve(ProviderUsageModel.parseCodexUsage(reserveResponse(100, 100), noCredits, 0), 1_000)).toBe(false)
    expect(shouldUseLunaReserve(ProviderUsageModel.parseCodexUsage({ rate_limit: reserveResponse(100, 0).rate_limit }, noCredits, 0), 1_000)).toBe(false)
    expect(shouldUseLunaReserve(undefined, 0)).toBe(false)
  })
})

describe('Luna Reserve routing', () => {
  it('sends the reserve slug while on reserve and the chosen model otherwise', () => {
    const upstream = openaiCodexProvider()
    const model = upstream.getModels()[0]
    if (model === undefined) throw new Error('pi-ai lists no Codex model')
    const sent: string[] = []
    let onReserve = true
    const routed = withLunaReserve({
      upstream: {
        ...upstream,
        streamSimple: requested => {
          sent.push(requested.id)
          throw new Error('recorded')
        },
      },
      onReserve: () => onReserve,
    })
    const context = normalizeContext({ messages: [] })
    expect(() => routed.streamSimple(model, context)).toThrow('recorded')
    onReserve = false
    expect(() => routed.streamSimple(model, context)).toThrow('recorded')
    expect(sent).toEqual([CODEX_RESERVE_MODEL, model.id])
  })
})
