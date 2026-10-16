import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountProfile, UsageCard } from './api.js'
import { usageHistoryDomain } from './usage-history.js'
import { createUsageHistoryService, type AccountUsageReader } from './usage-recorder.js'

const profile = (instanceId: string, kind: AccountProfile['kind'], enabled = true): AccountProfile => ({
  instanceId,
  kind,
  displayName: instanceId,
  enabled,
  homePath: '',
  shadowHomePath: '',
  apiKeyEnv: '',
  apiBaseUrl: '',
  badge: '',
  accentColor: '',
  providerIcon: '',
  mode: 'direct',
  signedIn: true,
  identity: null,
  plan: null,
  state: 'healthy',
  loginHint: '',
  detail: null,
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
})

const okCard = (remaining: number, resetsAt: number, banked = 0): UsageCard => ({
  status: 'ok',
  message: null,
  identity: null,
  plan: null,
  windows: [
    { label: 'Current session', percentRemaining: remaining, resetsAt },
    { label: 'Weekly limit', percentRemaining: 80, resetsAt: resetsAt + 86_400_000 },
  ],
  bankedResets: banked,
  bankedResetExpiries: Array.from({ length: banked }, (_, index) => resetsAt + index),
})

const roots: string[] = []
const contexts: Context[] = []

const openContext = async (): Promise<Context> => {
  const root = await mkdtemp(join(tmpdir(), 'ai-accounts-usage-'))
  roots.push(root)
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  contexts.push(context)
  return context
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await createUsageHistoryService(context).close()
    await context.fiber.dispose()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('usage history collection', () => {
  it('records every enabled account that answers, of every provider kind, and skips failures', async () => {
    const ctx = await openContext()
    const resetsAt = Date.now() + 3_600_000
    const answers: Record<string, UsageCard> = {
      codex_a: okCard(42, resetsAt, 2),
      claude_a: okCard(10, resetsAt),
      commandcode_a: okCard(90, resetsAt),
      cursor_a: { ...okCard(55, resetsAt), status: 'unauthenticated' },
    }
    const read: string[] = []
    const reader: AccountUsageReader = async account => {
      read.push(account.instanceId)
      const card = answers[account.instanceId]
      if (card === undefined) throw new Error('no answer')
      return card
    }
    const accounts = [
      profile('codex_a', 'codex'),
      profile('claude_a', 'claude'),
      profile('commandcode_a', 'commandcode'),
      profile('cursor_a', 'cursor'),
      profile('opencode_off', 'opencode-go', false),
      profile('broken', 'opencode-go'),
    ]

    expect(await createUsageHistoryService(ctx).collect(accounts, reader)).toBe(3)
    expect(read).not.toContain('opencode_off')

    const codex = await createUsageHistoryService(ctx).read('codex_a', 0)
    expect(codex).toHaveLength(1)
    expect(codex[0]?.windows).toEqual({ 'Current session': 42, 'Weekly limit': 80 })
    expect(codex[0]?.resetsAt['Current session']).toBe(resetsAt)
    expect(codex[0]?.bankedResets).toBe(2)
    expect(codex[0]?.bankedResetExpiries).toEqual([resetsAt, resetsAt + 1])
    expect(await createUsageHistoryService(ctx).read('cursor_a', 0)).toEqual([])

    const meta = await createUsageHistoryService(ctx).readSettings()
    expect(meta.lastReadAt).not.toBeNull()
    expect(meta.lastAttemptAt).toBe(meta.lastReadAt)
  })

  it('updates one row per account per interval bucket instead of accumulating', async () => {
    const ctx = await openContext()
    const resetsAt = Date.now() + 3_600_000
    let remaining = 70
    const reader: AccountUsageReader = async () => okCard(remaining, resetsAt)
    await createUsageHistoryService(ctx).collect([profile('codex_a', 'codex')], reader)
    remaining = 65
    await createUsageHistoryService(ctx).collect([profile('codex_a', 'codex')], reader)
    const rows = await createUsageHistoryService(ctx).read('codex_a', 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.windows['Current session']).toBe(65)
  })

  it('keeps a settings change saved while a sweep was reading', async () => {
    const ctx = await openContext()
    const reader: AccountUsageReader = async () => {
      await createUsageHistoryService(ctx).saveSettings({ intervalMinutes: 15 })
      return okCard(50, Date.now() + 60_000)
    }
    await createUsageHistoryService(ctx).collect([profile('codex_a', 'codex')], reader)
    expect((await createUsageHistoryService(ctx).readSettings()).intervalMinutes).toBe(15)
  })

  it('prunes snapshots older than the retention window', async () => {
    const ctx = await openContext()
    const old = Date.now() - 10 * 86_400_000
    await createUsageHistoryService(ctx).collect([profile('codex_a', 'codex')], async () => okCard(50, Date.now() + 60_000))
    const domain = ctx.get('storageDomain')?.get(usageHistoryDomain.name)
    await domain?.table('quota').put('v2:codex_a:5:1', { at: old, instanceId: 'codex_a', windows: { 'Weekly limit': 10 }, resetsAt: {}, bankedResets: 0 })
    expect(await createUsageHistoryService(ctx).prune(7)).toBe(1)
    const rows = await createUsageHistoryService(ctx).read('codex_a', 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.at).toBeGreaterThan(old)
  })
})

describe('usage history scheduler', () => {
  it('collects on start, shares one in-flight sweep with a manual refresh, and waits for the interval', async () => {
    const ctx = await openContext()
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let clock = Date.now()
    const scheduler = createUsageHistoryService(ctx).createScheduler(async () => ({ accounts: [profile('codex_a', 'codex')], shadowRoot: '' }), {
      now: () => clock,
      readUsage: async () => {
        calls += 1
        await gate
        return okCard(50, clock + 60_000)
      },
    })
    try {
      await new Promise(resolve => setTimeout(resolve, 20))
      const manual = scheduler.collectNow()
      release?.()
      expect(await manual).toBe(1)
      expect(calls).toBe(1)

      // Within the interval the next manual call reads again, but the timer would not.
      const meta = await createUsageHistoryService(ctx).readSettings()
      expect(clock - (meta.lastAttemptAt ?? 0)).toBeLessThan(meta.intervalMinutes * 60_000)
      clock += meta.intervalMinutes * 60_000
      expect(await scheduler.collectNow()).toBe(1)
      expect(calls).toBe(2)
    } finally {
      scheduler.dispose()
    }
    expect(await scheduler.collectNow()).toBe(0)
  })
})
