import type { SecretCatalogCredentialBridge } from '@dshfiles/credential-port'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountsHostFixture, type AccountsHost } from './accounts-host.fixture.js'
import { accountDraftSchema, accountsFileSchema, type AccountDraft } from './api.js'

/**
 * Every failure code the seven ai-accounts Host APIs put on the wire, and the account lock that rejects a concurrent
 * operation instead of queueing it. Domain failures are tagged errors with their own `dshxWireCode`; schema
 * (`contract`), version (`DSHX6401`) and missing-owner failures keep the codes dshx gives them.
 */
const running: AccountsHost[] = []

afterEach(async () => {
  for (const host of running.splice(0)) await host.dispose()
})

const start = async (input: Parameters<typeof AccountsHostFixture.start>[0]): Promise<AccountsHost> => {
  const host = await AccountsHostFixture.start(input)
  running.push(host)
  return host
}

const anyOutput = Schema.Json

interface WireCase {
  readonly apiId: string
  readonly method: string
  readonly payload: Schema.Json | undefined
  readonly version?: number
  readonly expected: { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message?: string | RegExp }
}

const BUSY = 'An account operation is already running. Wait for it to finish before changing its credentials or profile.'

const wireCases: readonly WireCase[] = [
  { apiId: 'ai-accounts', method: 'read', payload: undefined, expected: { ok: true } },
  {
    apiId: 'ai-accounts',
    method: 'read',
    payload: undefined,
    version: 2,
    expected: { ok: false, code: 'DSHX6401', message: 'API version mismatch for ai-accounts.' },
  },
  {
    apiId: 'ai-accounts',
    method: 'resumeQuotaContinuation',
    payload: { continuationId: 'not-a-uuid' },
    expected: { ok: false, code: 'contract', message: 'API schema validation failed: continuationId: Expected a UUID.' },
  },
  {
    apiId: 'ai-accounts',
    method: 'createSetupAccount',
    payload: { kind: 'codex', requestId: '00000000-0000-4000-8000-000000000000' },
    expected: {
      ok: false,
      code: 'setup-method-retired',
      message: 'This account setup method is retired. Use prepareAccountConnection on an updated client; no account was saved.',
    },
  },
  { apiId: 'ai-accounts', method: 'identity', payload: { instanceId: 'missing' }, expected: { ok: true } },
  { apiId: 'ai-accounts-model-fallback', method: 'state', payload: {}, expected: { ok: true } },
  {
    apiId: 'ai-accounts-model-fallback',
    method: 'setChain',
    payload: { chain: [{ provider: '', model: 'x' }] },
    expected: { ok: false, code: 'contract', message: /^API schema validation failed: chain/u },
  },
  {
    apiId: 'ai-accounts-model-fast-mode',
    method: 'status',
    payload: { provider: 'cc_a', model: 'gpt-6-luna' },
    expected: { ok: false, code: 'session-scope-refused', message: 'Fast mode requires a session ID.' },
  },
  {
    apiId: 'ai-accounts-model-fast-mode',
    method: 'setFast',
    payload: { provider: 'cc_a', model: 'gpt-6-luna', enabled: true },
    expected: { ok: false, code: 'session-scope-refused', message: 'Fast mode requires a session ID.' },
  },
  {
    apiId: 'ai-accounts-serving-account',
    method: 'snapshot',
    payload: {},
    expected: { ok: false, code: 'session-scope-refused', message: 'Serving account metadata requires a session ID.' },
  },
  { apiId: 'ai-accounts-serving-account', method: 'snapshot', payload: { sessionId: 5 }, expected: { ok: false, code: 'contract' } },
  { apiId: 'ai-accounts-login', method: 'begin', payload: { instanceId: 'missing' }, expected: { ok: true } },
  {
    apiId: 'ai-accounts-login',
    method: 'cancel',
    payload: { instanceId: 'missing' },
    expected: { ok: false, code: 'contract', message: /^API schema validation failed: confirm/u },
  },
  { apiId: 'ai-accounts-session', method: 'capability', payload: { instanceId: 'missing' }, expected: { ok: true } },
  {
    apiId: 'ai-accounts-session',
    method: 'signOut',
    payload: { instanceId: 'missing', confirm: true },
    expected: { ok: false, code: 'account-not-found', message: 'This saved account is no longer available.' },
  },
  {
    apiId: 'ai-accounts-thread',
    method: 'preview',
    payload: { sessionId: 'missing', instanceId: 'cc_a' },
    expected: { ok: false, code: 'owner-missing', message: '@dshfiles/session-controller is not loaded, so thread-model.snapshot is unavailable.' },
  },
]

describe('wire failure codes', { timeout: 30_000 }, () => {
  const titled = wireCases.map(wireCase => {
    const version = wireCase.version === undefined ? '' : ` v${String(wireCase.version)}`
    const outcome = wireCase.expected.ok ? 'ok' : wireCase.expected.code
    return [`${wireCase.apiId}.${wireCase.method}${version} → ${outcome}`, wireCase] as const
  })

  it.each(titled)('%s', async (_title, wireCase) => {
    const host = await start({ accounts: [{ id: 'cc_a' }], distribution: 'sticky' })
    const result = await AccountsHostFixture.callApi({ host: host.host, ...wireCase, output: anyOutput })

    if (wireCase.expected.ok) {
      expect(result.ok).toBe(true)
      return
    }
    if (result.ok) throw new Error(`Expected ${wireCase.apiId}.${wireCase.method} to fail.`)
    expect(result.error.code).toBe(wireCase.expected.code)
    if (wireCase.expected.message !== undefined) expect(result.error.message).toMatch(wireCase.expected.message)
  })

  it('answers an unknown method with a plain 404 rather than an API envelope', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }], distribution: 'sticky' })
    const response = await host.host.connection.requestApi({ packageId: '@dshfiles/ai-accounts', apiId: 'ai-accounts', method: 'nope', version: 1, input: {} })

    expect(response.status).toBe(404)
  })

  it('reports managed sign-in refusals as states with a domain errorCode, never as API failures', async () => {
    const host = await start({ accounts: [{ id: 'cc_a' }], distribution: 'sticky' })
    const begin = (instanceId: string) =>
      AccountsHostFixture.callApi({ host: host.host, apiId: 'ai-accounts-login', method: 'begin', payload: { instanceId }, output: anyOutput })

    expect(await begin('missing')).toMatchObject({ ok: true, value: { output: { status: 'error', errorCode: 'unavailable' } } })
    expect(await begin('cc_a')).toMatchObject({ ok: true, value: { output: { status: 'error', errorCode: 'unsupported' } } })
  })
})

describe('account lock', { timeout: 30_000 }, () => {
  const accountsCall = (host: AccountsHost, method: string, payload: Schema.Json | undefined) =>
    AccountsHostFixture.callApi({ host: host.host, apiId: 'ai-accounts', method, payload, output: anyOutput })

  const draftPayload = (account: AccountDraft | undefined): Schema.Json => {
    if (account === undefined) throw new Error('The fixture account is missing.')
    return Schema.encodeSync(Schema.toCodecJson(accountDraftSchema))({ ...account, displayName: 'Renamed' })
  }

  it('rejects a second operation on a busy account at once and leaves other accounts free', async () => {
    let releaseImport: () => void = () => undefined
    let importStarted: () => void = () => undefined
    const started = new Promise<void>(resolve => {
      importStarted = resolve
    })
    const bridge: SecretCatalogCredentialBridge = {
      listKeys: async () => [],
      importKey: () => {
        importStarted()
        return new Promise(resolve => {
          releaseImport = () => resolve()
        })
      },
    }
    const host = await start({
      accounts: [{ id: 'cc_a' }, { id: 'cc_b' }],
      distribution: 'sticky',
      beforeMount: testHost => {
        testHost.ctx.provide('secretCatalogCredentials', bridge)
      },
    })
    const read = await AccountsHostFixture.callApi({ host: host.host, apiId: 'ai-accounts', method: 'read', payload: undefined, output: accountsFileSchema })
    if (!read.ok) throw new Error(read.error.message)
    const byId = (id: string) => read.value.output.accounts.find(account => account.instanceId === id)

    const holding = accountsCall(host, 'importSecretCatalogKey', { instanceId: 'cc_a', alias: 'CC', environment: 'prod', scope: 'global', cwd: null })
    await started

    expect(await accountsCall(host, 'save', { draft: draftPayload(byId('cc_a')) })).toEqual({ ok: false, error: { code: 'account-busy', message: BUSY } })
    expect(await accountsCall(host, 'remove', { instanceId: 'cc_a' })).toEqual({ ok: false, error: { code: 'account-busy', message: BUSY } })
    expect(
      await AccountsHostFixture.callApi({
        host: host.host,
        apiId: 'ai-accounts-session',
        method: 'capability',
        payload: { instanceId: 'cc_a' },
        output: anyOutput,
      }),
    ).toMatchObject({
      ok: true,
      value: { output: { available: false, reason: 'An account operation is already running. Wait for it to finish before signing out.' } },
    })
    expect(await accountsCall(host, 'save', { draft: draftPayload(byId('cc_b')) })).toMatchObject({ ok: true })

    releaseImport()
    expect(await holding).toEqual({ ok: true, value: { version: 1, output: { imported: true, apiKeyEnv: 'CC_A_API_KEY' } } })
    expect(await accountsCall(host, 'save', { draft: draftPayload(byId('cc_a')) })).toMatchObject({ ok: true })
  })
})
