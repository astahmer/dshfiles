import { AccountsHostFixture, type AccountsHost } from './accounts-host.fixture.js'
import { accountDraftSchema, accountsFileSchema, type AccountDraft } from './api.js'
import * as Schema from 'effect/Schema'
import { servingAccountSnapshotSchema } from './serving-account-api.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Pins how the mounted Host routes, fails over and attributes requests today, so the Effect rewrite of `host.ts` can
 * prove parity. Every test drives the real agent loop; the wire account is the bearer key the fake provider saw.
 */
const running: AccountsHost[] = []

afterEach(async () => {
  for (const host of running.splice(0)) await host.dispose()
})

const FIXTURE_MODEL = AccountsHostFixture.model
const eventTypes = AccountsHostFixture.eventTypes
const eventsOfType = AccountsHostFixture.eventsOfType

const start = async (input: Parameters<typeof AccountsHostFixture.start>[0]): Promise<AccountsHost> => {
  const host = await AccountsHostFixture.start(input)
  running.push(host)
  return host
}

const rateLimited = { status: 429, message: 'Too many requests' } as const

const requestConfigs = (agent: Agent): readonly unknown[] =>
  eventsOfType(agent, 'request/header').map(event => (event.type === 'request/header' ? event.data.header.config : undefined))

const retryRows = (agent: Agent): readonly SessionEvent[] =>
  agent.session.snapshotEvents().filter(event => event.type === 'llm/retry' || event.type === 'llm/retry-started')

const nextTick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

const until = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 10_000 && !condition(); attempt++) await nextTick()
  if (!condition()) throw new Error('The condition never held.')
}

const servingSnapshot = (host: AccountsHost, sessionId: string) =>
  AccountsHostFixture.callApi({
    host: host.host,
    apiId: 'ai-accounts-serving-account',
    method: 'snapshot',
    payload: { sessionId },
    output: servingAccountSnapshotSchema,
  })

describe('agent/request-error fail-over', { timeout: 30_000 }, () => {
  it('fails a rate-limited sticky account over to its sibling before any later request-error listener runs', async () => {
    const laterListener: string[] = []
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'sticky', replies: [rateLimited] })
    host.host.ctx.on('agent/created', ({ agent }) => {
      agent.ctx.on('agent/request-error', async (_failure, next) => {
        laterListener.push('called')
        return next()
      })
      return undefined
    })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    await host.ask(agent, 'hello')

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_b'])
    expect(laterListener).toEqual([])
    const [retry, started] = retryRows(agent)
    expect(retryRows(agent).map(event => event.type)).toEqual(['llm/retry', 'llm/retry-started'])
    expect(retry?.data).toMatchObject({
      turn: 1,
      step: 1,
      provider: 'cc_a',
      mode: 'normal',
      policyKey: 'ai-accounts:rateLimit',
      retry: 1,
      maxRetries: 2,
      delayMs: 0,
      failure: { code: 'ACCOUNT_FAILOVER', message: expect.stringMatching(/^Switched from Account cc_a to Account cc_b after: 429/u) },
    })
    expect(started?.data).toEqual({ retryId: expect.any(String), turn: 1, step: 1, retry: 1 })
    expect(retry?.data).toMatchObject({ retryId: started?.type === 'llm/retry-started' ? started.data.retryId : '' })
    const types = eventTypes(agent)
    expect(types.indexOf('llm/retry-started')).toBeLessThan(types.indexOf('assistant/message'))
    expect(host.selected).toEqual([{ sessionId: 'thread-1', provider: 'cc_b', model: FIXTURE_MODEL }])
    expect(requestConfigs(agent)).toEqual([{ provider: 'cc_a', model: FIXTURE_MODEL }])
    expect(eventsOfType(agent, 'turn/end').at(-1)?.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
  })

  it('keeps the selected effort on an account fail-over and moves the selection with it', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'sticky', replies: [rateLimited] })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a', reasoningEffort: 'high' })
    await host.ask(agent, 'hello')

    expect(host.chats.map(chat => [chat.account, chat.reasoningEffort])).toEqual([
      ['cc_a', 'high'],
      ['cc_b', 'high'],
    ])
    expect(host.selected).toEqual([{ sessionId: 'thread-1', provider: 'cc_b', model: FIXTURE_MODEL, reasoningEffort: 'high' }])
  })

  it('drops the proposed effort when a Priority fallback route replaces the failed one', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'priority', replies: [rateLimited] })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a', reasoningEffort: 'high' })
    await host.ask(agent, 'hello')

    expect(host.chats.map(chat => [chat.account, chat.reasoningEffort])).toEqual([
      ['cc_a', 'high'],
      ['cc_b', undefined],
    ])
    expect(requestConfigs(agent)).toEqual([
      { provider: 'cc_a', model: FIXTURE_MODEL, reasoningEffort: 'high' },
      { provider: 'cc_b', model: FIXTURE_MODEL },
    ])
    expect(retryRows(agent)[0]?.data).toMatchObject({
      provider: 'cc_a',
      failure: { code: 'ACCOUNT_FAILOVER', message: expect.stringMatching(/^Switched from Account cc_a to Account cc_b · gpt-6-luna after: 429/u) },
    })
    expect(host.selected).toEqual([{ sessionId: 'thread-1', provider: 'cc_b', model: FIXTURE_MODEL }])

    await host.ask(agent, 'again')
    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_b', 'cc_b'])
  })

  it('waits out a rate limit with no sibling for the delay the provider asked, then opens the retry', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }], distribution: 'sticky', replies: [rateLimited], retryAfterMs: 50 })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    await host.ask(agent, 'hello')

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_a'])
    expect(retryRows(agent).map(event => event.type)).toEqual(['llm/retry', 'llm/retry-started'])
    expect(retryRows(agent)[0]?.data).toMatchObject({
      provider: 'cc_a',
      policyKey: 'ai-accounts:rateLimit',
      retry: 1,
      maxRetries: 1,
      delayMs: 50,
      failure: { code: 'RATE_LIMIT', message: expect.stringMatching(/^Account cc_a: 429/u) },
    })
    expect(host.selected).toEqual([])
  })

  it('waits the Retry-After the provider sent on the rejected response instead of the policy minute', async () => {
    const host = await start({
      accounts: [{ id: 'cc_a' }],
      distribution: 'sticky',
      replies: [{ ...rateLimited, headers: { 'retry-after': '0.05' } }],
    })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    await host.ask(agent, 'hello')

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_a'])
    expect(retryRows(agent).map(event => event.type)).toEqual(['llm/retry', 'llm/retry-started'])
    expect(retryRows(agent)[0]?.data).toMatchObject({ delayMs: 50, failure: { code: 'RATE_LIMIT' } })
  })

  it('waits the policy minute when the provider names no delay', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }], distribution: 'sticky', replies: [rateLimited] })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await until(() => eventTypes(agent).includes('llm/retry'))

    expect(retryRows(agent)[0]?.data).toMatchObject({ delayMs: 60_000, maxRetries: 1 })
    expect(eventTypes(agent)).not.toContain('llm/retry-started')
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    expect(eventTypes(agent)).not.toContain('llm/retry-started')
    expect(host.chats).toHaveLength(1)
  })

  it('keeps a selection the user made during the wait: no llm/retry-started and no automatic selection', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }], distribution: 'sticky', userSelections: true, replies: [rateLimited], retryAfterMs: 1_500 })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    const turn = host.ask(agent, 'hello')
    await until(() => eventTypes(agent).includes('llm/retry'))
    agent.session.append('model/selection', { provider: 'cc_a', model: FIXTURE_MODEL })
    await turn

    expect(retryRows(agent).map(event => event.type)).toEqual(['llm/retry'])
    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_a'])
    expect(host.selected).toEqual([])
    expect(eventsOfType(agent, 'turn/end').at(-1)?.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
  })

  it('keeps a selection the user made before the failure surfaced: no llm/retry row at all', async () => {
    let agent: Agent | undefined
    const host = await start({
      accounts: [{ id: 'cc_a' }, { id: 'cc_b' }],
      distribution: 'sticky',
      userSelections: true,
      replies: [rateLimited],
      onChat: ({ index }) => {
        if (index === 0) agent?.session.append('model/selection', { provider: 'cc_a', model: FIXTURE_MODEL })
      },
    })
    agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    await host.ask(agent, 'hello')

    expect(retryRows(agent)).toEqual([])
    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_b'])
    expect(host.selected).toEqual([])
  })
})

describe('agent/request routing', { timeout: 30_000 }, () => {
  it('serves a selection that names no adapter from an account route offering the same model', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'sticky' })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'retired_account' })
    await host.ask(agent, 'hello')

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a'])
    expect(requestConfigs(agent)).toEqual([{ provider: 'cc_a', model: FIXTURE_MODEL }])
  })

  it('refuses a selection no account or native provider serves with NO_ADAPTER before any request', async () => {
    const host = await start({ accounts: [{ id: 'cc_a', enabled: false }], distribution: 'sticky' })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'retired_account' })
    await host.ask(agent, 'hello')

    expect(host.chats).toEqual([])
    expect(eventTypes(agent)).not.toContain('request/header')
    expect(eventsOfType(agent, 'turn/end').at(-1)?.data).toEqual({
      turn: 1,
      reason: {
        kind: 'error',
        error: {
          code: 'NO_ADAPTER',
          message:
            'No adapter serves provider "retired_account" on this Host. Pick a model from a configured provider, or add the account for "retired_account".',
        },
      },
    })
  })

  it('keeps a sticky thread on the account a fail-over bound for its later turns', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'sticky', replies: [rateLimited] })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    await host.ask(agent, 'one')
    await host.ask(agent, 'two')

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_b', 'cc_b'])
    expect(requestConfigs(agent)).toEqual([{ provider: 'cc_a', model: FIXTURE_MODEL }])
  })

  it('spreads round-robin threads across accounts while each thread keeps its turn account', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'round-robin' })
    const first = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    const second = await host.startThread({ sessionId: 'thread-2', provider: 'cc_a' })
    await host.ask(first, 'one')
    await host.ask(second, 'two')
    await host.ask(first, 'three')
    await host.ask(second, 'four')

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_b', 'cc_a', 'cc_b'])
  })
})

describe('llm/stream attribution', { timeout: 30_000 }, () => {
  it('credits the account the fail-over put on the wire, and never lets a side request claim it', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'sticky', replies: [rateLimited] })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    await host.ask(agent, 'hello')
    const served = {
      ok: true,
      value: {
        version: 1,
        output: {
          sessionId: 'thread-1',
          currentAttempt: null,
          lastSuccessful: { sessionId: 'thread-1', accountId: 'cc_b', provider: 'commandcode', model: FIXTURE_MODEL, turn: 1, step: 1, status: 'succeeded' },
        },
      },
    }
    expect(await servingSnapshot(host, 'thread-1')).toMatchObject(served)

    const side = host.host.ctx.llm.stream({ provider: 'cc_a', model: FIXTURE_MODEL, sessionId: SessionId('thread-1'), purpose: 'session-title', messages: [] })
    for await (const chunk of side) void chunk

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_b', 'cc_b'])
    expect(await servingSnapshot(host, 'thread-1')).toMatchObject(served)
  })

  it('takes the first healthy account for a Priority side request instead of the cooling selected route', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'priority', replies: [rateLimited] })
    const agent = await host.startThread({ sessionId: 'thread-1', provider: 'cc_a' })
    await host.ask(agent, 'hello')
    const side = host.host.ctx.llm.stream({
      provider: 'cc_a',
      model: FIXTURE_MODEL,
      sessionId: SessionId('other-thread'),
      purpose: 'session-title',
      messages: [],
    })
    for await (const chunk of side) void chunk

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a', 'cc_b', 'cc_b'])
  })
})

describe('activation', { timeout: 30_000 }, () => {
  it('registers every enabled account route by the time the plugin is active', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }, { id: 'cc_off', enabled: false }], distribution: 'sticky' })
    const providers = host.host.ctx.llm.listProviders().map(provider => provider.id)

    expect(providers).toContain('cc_a')
    expect(providers).toContain('cc_b')
    expect(providers).not.toContain('cc_off')
  })

  it('serves the first request of a thread that existed before the plugin mounted', async () => {
    const early: Agent[] = []
    const host = await start({
      accounts: [{ id: 'cc_a' }],
      distribution: 'sticky',
      beforeMount: async testHost => {
        const handle = await testHost.ctx.agents.create({
          sessionId: SessionId('resumed-thread'),
          meta: { cwd: process.cwd() },
          agentOptions: { provider: 'cc_a', model: FIXTURE_MODEL },
        })
        early.push(handle.agent)
      },
    })
    const agent = early[0]
    if (agent === undefined) throw new Error('The early thread was not created.')
    await host.ask(agent, 'hello')

    expect(host.chats.map(chat => chat.account)).toEqual(['cc_a'])
    expect(eventsOfType(agent, 'turn/end').at(-1)?.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
    await agent.ctx.fiber.dispose()
  })
})

describe('route refresh', { timeout: 30_000 }, () => {
  const accountsCall = (host: AccountsHost, method: string, payload: Schema.Json | undefined) =>
    AccountsHostFixture.callApi({ host: host.host, apiId: 'ai-accounts', method, payload, output: accountsFileSchema })

  const draftPayload = (account: AccountDraft | undefined, enabled: boolean): Schema.Json => {
    if (account === undefined) throw new Error('The fixture account is missing.')
    return Schema.encodeSync(Schema.toCodecJson(accountDraftSchema))({ ...account, enabled })
  }

  it('applies concurrent saves in order so the last write decides the registered routes', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }], distribution: 'sticky' })
    const file = await accountsCall(host, 'read', undefined)
    if (!file.ok) throw new Error(file.error.message)
    const byId = (id: string) => file.value.output.accounts.find(account => account.instanceId === id)
    const results = await Promise.all([
      accountsCall(host, 'save', { draft: draftPayload(byId('cc_b'), false) }),
      accountsCall(host, 'setDistribution', { distribution: 'round-robin' }),
      accountsCall(host, 'save', { draft: draftPayload(byId('cc_a'), false) }),
    ])

    expect(results.map(result => result.ok)).toEqual([true, true, true])
    const providers = host.host.ctx.llm.listProviders().map(provider => provider.id)
    expect(providers).not.toContain('cc_a')
    expect(providers).not.toContain('cc_b')
    expect(await accountsCall(host, 'read', undefined)).toMatchObject({ ok: true, value: { output: { distribution: 'round-robin' } } })
  })
})
