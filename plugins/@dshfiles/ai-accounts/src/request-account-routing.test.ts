import { describe, expect, it } from 'vitest'
import { createAccountPool } from './account-pool.js'
import { failoverAccountIds, selectRequestAccount } from './request-account-routing.js'

const routes = new Map<string, { readonly kind: string; readonly enabled: boolean }>([
  ['codex-work', { kind: 'codex', enabled: true }],
  ['claude-work', { kind: 'claude', enabled: true }],
  ['codex-personal', { kind: 'codex', enabled: true }],
  ['codex-alt', { kind: 'codex', enabled: true }],
  ['codex-disabled', { kind: 'codex', enabled: false }],
])

const poolFor = (distribution: 'sticky' | 'priority' | 'round-robin' | 'balanced') => {
  const pool = createAccountPool({ distribution })
  pool.replace([...routes].map(([id, route]) => ({ id, kind: route.kind, label: id, enabled: route.enabled })))
  return pool
}

const offersModel = (provider: string, model: string): boolean => {
  const models = new Map<string, readonly string[]>([
    ['codex-work', ['gpt-6', 'shared-model']],
    ['claude-work', ['claude-sonnet']],
    ['codex-personal', ['gpt-6', 'shared-model']],
    ['codex-alt', ['gpt-6', 'shared-model']],
    ['codex-disabled', ['gpt-6']],
  ])
  return models.get(provider)?.includes(model) === true
}
const modelSurfaces = new Map<string, string>([
  ['codex-work:gpt-6', 'text,image'],
  ['codex-personal:gpt-6', 'text,image'],
  ['codex-disabled:gpt-6', 'text,image'],
  ['codex-alt:gpt-6', 'text,image'],
  ['codex-work:shared-model', 'text,image'],
  ['codex-personal:shared-model', 'text'],
  ['codex-alt:shared-model', 'text'],
  ['claude-work:claude-sonnet', 'text'],
])
const modelsCompatible = (sourceProvider: string, candidateProvider: string, model: string): boolean =>
  offersModel(sourceProvider, model) &&
  offersModel(candidateProvider, model) &&
  modelSurfaces.get(`${sourceProvider}:${model}`) === modelSurfaces.get(`${candidateProvider}:${model}`)

const select = (input: { readonly provider: string; readonly model: string; readonly pool: ReturnType<typeof poolFor>; readonly now?: number }): string =>
  selectRequestAccount({
    provider: input.provider,
    model: input.model,
    conversationKey: 'session-one',
    routes,
    pool: input.pool,
    modelsCompatible,
    ...(input.now === undefined ? {} : { now: input.now }),
  })

describe('request account routing', () => {
  it('routes Priority through the first healthy same-provider account that offers the model', () => {
    const pool = poolFor('priority')

    expect(select({ provider: 'codex-personal', model: 'gpt-6', pool })).toBe('codex-work')
    pool.noteRateLimited('codex-work', 5_000, 1_000)
    expect(select({ provider: 'codex-personal', model: 'gpt-6', pool, now: 1_001 })).toBe('codex-personal')
  })

  it('does not distribute across same-id models with incompatible request metadata', () => {
    const pool = poolFor('priority')

    expect(select({ provider: 'codex-personal', model: 'shared-model', pool })).toBe('codex-personal')
  })

  it('keeps Sticky on the selected account and does not mix provider kinds', () => {
    const pool = poolFor('sticky')

    expect(select({ provider: 'codex-personal', model: 'gpt-6', pool })).toBe('codex-personal')
    expect(select({ provider: 'claude-work', model: 'claude-sonnet', pool })).toBe('claude-work')
  })

  it('keeps round-robin cursors independent for each provider kind', () => {
    const pool = poolFor('round-robin')

    expect(select({ provider: 'codex-work', model: 'gpt-6', pool })).toBe('codex-work')
    expect(select({ provider: 'claude-work', model: 'claude-sonnet', pool })).toBe('claude-work')
    expect(select({ provider: 'codex-work', model: 'gpt-6', pool })).toBe('codex-personal')
  })

  it('uses account order for Priority failover and usage order for other modes', () => {
    const input = {
      from: 'codex-work',
      model: 'gpt-6',
      routes,
      usageOrder: ['codex-alt', 'codex-personal'],
      hiddenAccountIds: [],
      modelsCompatible,
    }

    expect(failoverAccountIds({ ...input, distribution: 'priority' })).toEqual(['codex-personal', 'codex-alt'])
    expect(failoverAccountIds({ ...input, distribution: 'sticky' })).toEqual(['codex-alt', 'codex-personal'])
  })

  it('keeps failover inside enabled same-provider model routes and skips hidden accounts', () => {
    expect(
      failoverAccountIds({
        from: 'codex-work',
        model: 'gpt-6',
        routes,
        distribution: 'priority',
        usageOrder: [],
        hiddenAccountIds: ['codex-personal'],
        modelsCompatible,
      }),
    ).toEqual(['codex-alt'])
  })
})
