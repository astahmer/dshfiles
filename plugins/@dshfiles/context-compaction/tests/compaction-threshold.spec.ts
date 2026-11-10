import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-token-meter'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import { compactionThresholdTokens } from '../src/compaction-threshold.js'
import plugin from '../src/host.js'

/** compaction-basic's documented defaults. */
const DEFAULTS = { thresholdRatio: 0.8, headroomTokens: 65_536, retainRatio: 0.16, modelPolicies: [] }
const route = { provider: 'p', model: 'm' }

describe('the compaction threshold', () => {
  it('takes the window fraction or the window less output and headroom, whichever is smaller', () => {
    expect(compactionThresholdTokens({ config: DEFAULTS, route, contextWindow: 1_000_000, reservedCompletionTokens: 8_192 })).toBe(800_000)
    expect(compactionThresholdTokens({ config: DEFAULTS, route, contextWindow: 200_000, reservedCompletionTokens: 8_192 })).toBe(126_272)
  })

  it('applies an exact-route override and ignores other routes', () => {
    const config = { ...DEFAULTS, modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 0.5 }] }
    expect(compactionThresholdTokens({ config, route, contextWindow: 1_000_000, reservedCompletionTokens: 0 })).toBe(500_000)
    expect(compactionThresholdTokens({ config, route: { provider: 'p', model: 'other' }, contextWindow: 1_000_000, reservedCompletionTokens: 0 })).toBe(800_000)
  })

  it('is null where the engine skips proactive compaction', () => {
    expect(compactionThresholdTokens({ config: DEFAULTS, route, contextWindow: 64_000, reservedCompletionTokens: 8_192 })).toBeNull()
    expect(
      compactionThresholdTokens({
        config: { thresholdRatio: 0.8, headroomTokens: 65_536, retainTokens: 900_000, modelPolicies: [] },
        route,
        contextWindow: 1_000_000,
        reservedCompletionTokens: 0,
      }),
    ).toBeNull()
  })
})

describe('the threshold API', () => {
  const request = { packageId: '@dshfiles/context-compaction', apiId: 'context-compaction', method: 'threshold', version: 1 }

  it('reads the running engine policy, the routed output cap and the meter for a live thread', async () => {
    const host = await createTestHost()
    const sessions = new Map([['session-live', { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) }]])
    host.ctx.provide('llm', { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 }, defaultMaxTokens: 8_192 }) })
    host.ctx.provide('tokenMeter', { measure: () => ({ totalTokens: 42_000 }) })
    host.ctx.provide('sessions', {})
    host.ctx.provide('agents', { get: (id: string) => (sessions.has(id) ? { session: sessions.get(id) } : undefined) })
    try {
      const mounted = await host.mount(plugin, { packageId: '@dshfiles/context-compaction', config: {} })
      const live = await host.connection.requestApi({ ...request, input: { sessionId: 'session-live' } })
      expect(await live.json()).toMatchObject({
        result: {
          ok: true,
          value: { output: { provider: 'p', model: 'm', auto: true, contextWindow: 200_000, thresholdTokens: 126_272, usedTokens: 42_000 } },
        },
      })
      const gone = await host.connection.requestApi({ ...request, input: { sessionId: 'session-gone' } })
      expect(await gone.json()).toMatchObject({ result: { ok: true, value: { output: null } } })
      await mounted.dispose()
    } finally {
      await host.dispose()
    }
  })
})
