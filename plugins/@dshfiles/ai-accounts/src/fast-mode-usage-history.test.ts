import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { createFastModeUsageHistoryService } from './fast-mode-usage-history.js'
import { FastModeUsageModel } from './fast-mode-usage-model.js'

const roots: string[] = []
const contexts: Context[] = []
const services: ReturnType<typeof createFastModeUsageHistoryService>[] = []

const openContext = async (): Promise<Context> => {
  const root = await mkdtemp(join(tmpdir(), 'ai-accounts-fast-mode-'))
  roots.push(root)
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  contexts.push(context)
  return context
}

const createService = (context: Context, now: () => number) => {
  const service = createFastModeUsageHistoryService(context, { readRetentionDays: async () => 90, now })
  services.push(service)
  return service
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Fast mode usage history', () => {
  it('aggregates provider-confirmed Fast, default, incomplete and unreported responses', () => {
    const at = 1_700_000_000_000
    const base = {
      at,
      instanceId: 'codex-primary',
      model: 'gpt-6-luna',
      responseStatus: 'completed' as const,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
    }
    const history = FastModeUsageModel.aggregate(
      [
        { ...base, serviceTier: 'fast' },
        { ...base, serviceTier: 'priority' },
        { ...base, serviceTier: 'default' },
        { ...base, serviceTier: null, responseStatus: 'incomplete' },
      ],
      60 * 60_000,
    )

    expect(history.points).toEqual([
      {
        at: Math.floor(at / (60 * 60_000)) * (60 * 60_000),
        requests: 4,
        confirmedFast: 2,
        returnedDefault: 1,
        otherTier: 0,
        unreportedTier: 1,
        completed: 3,
        incomplete: 1,
        inputTokens: 400,
        outputTokens: 80,
        cacheReadTokens: 160,
      },
    ])
  })

  it('persists sanitized request usage and respects retention pruning', async () => {
    const context = await openContext()
    let clock = 1_700_000_000_000
    const service = createService(context, () => clock)

    await service.record({
      instanceId: 'codex-primary',
      model: 'gpt-6-luna',
      serviceTier: 'fast',
      responseStatus: 'completed',
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 3,
    })
    expect(await service.read('codex-primary', clock - 60 * 60_000)).toMatchObject({
      points: [{ requests: 1, confirmedFast: 1, inputTokens: 12, outputTokens: 4, cacheReadTokens: 3 }],
    })
    expect(await service.read('another-account', clock - 60 * 60_000)).toEqual({ points: [] })

    clock += 2 * 24 * 60 * 60_000
    expect(await service.prune(1)).toBe(1)
    expect(await service.read('codex-primary', 0)).toEqual({ points: [] })
  })
})
