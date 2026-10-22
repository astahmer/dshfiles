import { describe, expect, it } from 'vitest'
import { createAccountPool } from './account-pool.js'
import { RequestAccountRouting } from './request-account-routing.js'

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

const select = (input: { readonly provider: string; readonly model: string; readonly pool: ReturnType<typeof poolFor>; readonly now?: number }): string => {
  const base = { provider: input.provider, model: input.model, conversationKey: 'session-one', routes, pool: input.pool, modelsCompatible }
  return RequestAccountRouting.selectRequestAccount(input.now === undefined ? base : { ...base, now: input.now })
}

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

    expect(RequestAccountRouting.failoverAccountIds({ ...input, distribution: 'priority' })).toEqual(['codex-personal', 'codex-alt'])
    expect(RequestAccountRouting.failoverAccountIds({ ...input, distribution: 'sticky' })).toEqual(['codex-alt', 'codex-personal'])
  })

  it('keeps failover inside enabled same-provider model routes and skips hidden accounts', () => {
    expect(
      RequestAccountRouting.failoverAccountIds({
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

  it('sends Priority side requests such as session titles past a cooling selected account', () => {
    const pool = poolFor('priority')
    pool.noteRateLimited('codex-work', 60_000, 1_000)
    const wire = (purpose: string | undefined) =>
      RequestAccountRouting.wireAccountFor({
        provider: 'codex-work',
        model: 'gpt-6',
        purpose,
        conversationKey: 'session-one',
        active: undefined,
        routes,
        pool,
        modelsCompatible,
        now: 2_000,
      })

    expect(wire('session-title')).toBe('codex-personal')
    expect(wire(undefined)).toBe('codex-work')
  })

  it('keeps the account a main request was routed to for every chunk of that request', () => {
    const pool = poolFor('priority')

    expect(
      RequestAccountRouting.wireAccountFor({
        provider: 'codex-personal',
        model: 'gpt-6',
        purpose: undefined,
        conversationKey: 'session-one',
        active: { provider: 'codex-personal', model: 'gpt-6', accountId: 'codex-alt' },
        routes,
        pool,
        modelsCompatible,
      }),
    ).toBe('codex-alt')
  })
})

describe('fallback grouping', () => {
  it('keeps a Claude account out of fail-over as source and as target', () => {
    const claudeRoutes = new Map(routes)
    claudeRoutes.set('claude-alt', { kind: 'claude', enabled: true })

    expect(
      RequestAccountRouting.failoverAccountIds({
        from: 'claude-work',
        model: undefined,
        routes: claudeRoutes,
        distribution: 'priority',
        usageOrder: [],
        hiddenAccountIds: [],
        modelsCompatible,
      }),
    ).toEqual([])

    const codexFallbacks = RequestAccountRouting.failoverAccountIds({
      from: 'codex-work',
      model: undefined,
      routes: claudeRoutes,
      distribution: 'priority',
      usageOrder: [],
      hiddenAccountIds: [],
      modelsCompatible,
    })
    expect(codexFallbacks).toEqual(['codex-personal', 'codex-alt'])
    expect(codexFallbacks).not.toContain('claude-work')
  })
})

describe('sticky preflight', () => {
  const now = 1_000

  it('moves a cooling selected account to a healthy compatible one and binds it', () => {
    const pool = poolFor('sticky')
    pool.noteRateLimited('codex-work', 60_000, now)

    expect(
      RequestAccountRouting.preflightAccount({
        provider: 'codex-work',
        model: 'gpt-6',
        conversationKey: 'session-one',
        routes,
        pool,
        modelsCompatible,
        now: now + 1,
      }),
    ).toBe('codex-personal')
    expect(pool.routeFor('session-one', 'codex-work', now + 1)).toBe('codex-personal')
    expect(pool.routeFor('session-one', 'codex-work', now + 61_000)).toBe('codex-work')
  })

  it('moves a stuck stand-in to another healthy sibling', () => {
    const pool = poolFor('sticky')
    pool.noteRateLimited('codex-work', 600_000, now)
    expect(
      RequestAccountRouting.preflightAccount({
        provider: 'codex-work',
        model: 'gpt-6',
        conversationKey: 'session-one',
        routes,
        pool,
        modelsCompatible,
        now: now + 1,
      }),
    ).toBe('codex-personal')

    pool.noteRateLimited('codex-personal', 600_000, now + 2)
    expect(
      RequestAccountRouting.preflightAccount({
        provider: 'codex-work',
        model: 'gpt-6',
        conversationKey: 'session-one',
        routes,
        pool,
        modelsCompatible,
        now: now + 3,
      }),
    ).toBe('codex-alt')
  })

  it('leaves a healthy selected account alone', () => {
    const pool = poolFor('sticky')

    expect(
      RequestAccountRouting.preflightAccount({
        provider: 'codex-work',
        model: 'gpt-6',
        conversationKey: 'session-one',
        routes,
        pool,
        modelsCompatible,
        now,
      }),
    ).toBe('codex-work')
    expect(pool.routeFor('session-one', 'codex-work', now)).toBe('codex-work')
  })

  it('preflights Sticky turns and distributes Priority turns', () => {
    const sticky = poolFor('sticky')
    sticky.noteRateLimited('codex-work', 60_000, now)

    expect(
      RequestAccountRouting.selectTurnAccount({
        provider: 'codex-work',
        model: 'gpt-6',
        conversationKey: 'session-one',
        routes,
        pool: sticky,
        modelsCompatible,
        chainWalking: false,
        now: now + 1,
      }),
    ).toBe('codex-personal')

    expect(
      RequestAccountRouting.selectTurnAccount({
        provider: 'codex-personal',
        model: 'gpt-6',
        conversationKey: 'session-one',
        routes,
        pool: poolFor('priority'),
        modelsCompatible,
        chainWalking: false,
        now,
      }),
    ).toBe('codex-work')

    expect(
      RequestAccountRouting.selectTurnAccount({
        provider: 'codex-personal',
        model: 'gpt-6',
        conversationKey: 'session-one',
        routes,
        pool: poolFor('priority'),
        modelsCompatible,
        chainWalking: true,
        now,
      }),
    ).toBe('codex-personal')
  })
})

describe('selection preflight', () => {
  const preflight = (input: { readonly provider: string; readonly model: string; readonly pool: ReturnType<typeof poolFor>; readonly now?: number }) => {
    const base = { provider: input.provider, model: input.model, routes, nativeProviders: ['deepseek'], offersModel, pool: input.pool }
    return RequestAccountRouting.selectionPreflight(input.now === undefined ? base : { ...base, now: input.now })
  }

  it('passes a provider this Host already serves', () => {
    expect(preflight({ provider: 'codex-work', model: 'gpt-6', pool: poolFor('sticky') })).toEqual({ kind: 'served' })
    expect(preflight({ provider: 'deepseek', model: 'deepseek-chat', pool: poolFor('sticky') })).toEqual({ kind: 'served' })
  })

  it('moves a selection with no adapter to a healthy route that offers the model', () => {
    expect(preflight({ provider: 'codex-removed', model: 'gpt-6', pool: poolFor('sticky') })).toEqual({ kind: 'route', provider: 'codex-work' })
  })

  it('names the unserved provider in a typed error', () => {
    const error = RequestAccountRouting.unservedProviderError('removed_account')
    expect(error.code).toBe('NO_ADAPTER')
    expect(error.message).toContain('removed_account')
  })

  it('names the selection unserved when no route can take the model', () => {
    expect(preflight({ provider: 'codex-removed', model: 'missing-model', pool: poolFor('sticky') })).toEqual({ kind: 'unserved' })

    const cooling = poolFor('sticky')
    for (const id of ['codex-work', 'codex-personal', 'codex-alt']) cooling.noteRateLimited(id, 60_000, 1_000)
    expect(preflight({ provider: 'codex-removed', model: 'gpt-6', pool: cooling, now: 1_001 })).toEqual({ kind: 'unserved' })
  })
})
