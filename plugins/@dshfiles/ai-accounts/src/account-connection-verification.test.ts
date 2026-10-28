import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import type { z } from 'zod'
import type { AccountKind, AccountProfile } from './api.js'
import { readAccountUsage } from './account-usage.js'
import { verifyAccountConnection } from './account-connection-verification.js'
import { claudeAccountService } from './claude-account.js'
import { readCommandCodeKey } from './commandcode-usage.js'
import { readCursorToken } from './cursor-account.js'
import { ProviderUsageModel } from './usage.js'

const files = vi.hoisted(() => {
  const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected synthetic fetch'))
  // Stub before module initialization too: existing services may capture fetch in their dependency object.
  vi.stubGlobal('fetch', network)
  return { network, readFile: vi.fn<(path: string) => Promise<string>>(), keychain: vi.fn<() => Promise<string | undefined>>() }
})
vi.mock('node:fs/promises', async importOriginal => ({ ...(await importOriginal<typeof import('node:fs/promises')>()), readFile: files.readFile }))
vi.mock('./keychain.js', () => ({ readKeychainSecret: files.keychain }))
vi.mock('node:child_process', () => ({
  execFile: vi.fn(() => {
    throw new Error('Unexpected subprocess in synthetic verifier test')
  }),
}))
vi.mock('node:os', async importOriginal => ({
  ...(await importOriginal<typeof import('node:os')>()),
  userInfo: () => ({ homedir: '/synthetic', username: 'synthetic', uid: 1000, gid: 1000, shell: '/bin/false' }),
  homedir: () => '/synthetic',
}))

type VerificationInput = Parameters<typeof verifyAccountConnection>[0]
const RETRY = 'Could not verify this account connection. Check sign-in and try again.'
const SENSITIVE = 'synthetic-secret https://private.invalid/synthetic?key=synthetic-secret'
const cursorToken = `fake.${Buffer.from(JSON.stringify({ sub: 'user|synthetic' })).toString('base64url')}.fake`
const kinds: readonly AccountKind[] = ['codex', 'github-copilot', 'claude', 'opencode-go', 'commandcode', 'cursor']

const accountFor = (kind: AccountKind, keyedClaude = false): AccountProfile => ({
  instanceId: 'synthetic-account',
  kind,
  displayName: 'Synthetic account',
  enabled: true,
  homePath: '/synthetic/account-home',
  shadowHomePath: '',
  apiKeyEnv: kind === 'opencode-go' || kind === 'commandcode' || kind === 'cursor' || keyedClaude ? 'SYNTHETIC_API_KEY' : '',
  apiBaseUrl: '',
  badge: '',
  accentColor: '',
  providerIcon: '',
  mode: 'direct',
  signedIn: false,
  identity: null,
  plan: null,
  state: 'unconfigured',
  loginHint: '',
  detail: null,
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
})

const requestFor = (kind: AccountKind, keyedClaude = false): VerificationInput => ({
  account: accountFor(kind, keyedClaude),
  ...(kind === 'claude' && !keyedClaude ? { readAccountUsage } : {}),
  shadowRoot: '/synthetic/shadows',
  resolveCredential: vi.fn(async () => (kind === 'cursor' ? cursorToken : 'synthetic-key')),
  readCopilotCredential: vi.fn<VerificationInput['readCopilotCredential']>(async () => ({
    type: 'oauth',
    access: 'synthetic-access',
    refresh: 'synthetic-refresh',
    expires: Number.MAX_SAFE_INTEGER,
  })),
})

const successfulBody = (kind: AccountKind, exhausted = false) => {
  const used = exhausted ? 100 : 20
  switch (kind) {
    case 'codex':
      return { rate_limit: { primary_window: { used_percent: used } } }
    case 'github-copilot':
      return { quota_snapshots: { premium_interactions: { percent_remaining: 100 - used } } }
    case 'claude':
      return { five_hour: { utilization: used } }
    case 'opencode-go':
      return { usage: { weekly: { percent: used, status: exhausted ? 'rate-limited' : 'ok' } } }
    case 'commandcode':
      return { windowLimits: { weekly: { used, cap: 100, exceeded: exhausted } } }
    case 'cursor':
      return { individualUsage: { plan: { totalPercentUsed: used } } }
  }
}

const network = files.network
const networkReply = (body: z.infer<ReturnType<typeof z.json>>, status = 200): void => {
  network.mockImplementation(async () => new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  files.readFile.mockReset().mockImplementation(async path => {
    const name = String(path)
    if (name === '/synthetic/shadows/synthetic-account/auth.json')
      return JSON.stringify({ tokens: { access_token: 'synthetic-access', account_id: 'synthetic-id' } })
    if (name === '/synthetic/account-home/.credentials.json')
      return JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-access', expiresAt: Number.MAX_SAFE_INTEGER } })
    throw new Error('No synthetic file')
  })
  files.keychain.mockReset().mockResolvedValue(undefined)
  network.mockReset().mockRejectedValue(new Error('Unexpected synthetic fetch'))
  vi.stubGlobal('fetch', network)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe.each(kinds)('%s real owned quota adapter, synthetic I/O', kind => {
  it('requires successful authenticated provider metadata, not local presence', async () => {
    networkReply(successfulBody(kind))
    await expect(verifyAccountConnection(requestFor(kind))).resolves.toBeUndefined()
    expect(network).toHaveBeenCalled()
    for (const [, init] of network.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(init?.body).toBeUndefined()
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('accepts authenticated exhausted quota, including OpenCode rate-limited windows', async () => {
    networkReply(successfulBody(kind, true))
    await expect(verifyAccountConnection(requestFor(kind))).resolves.toBeUndefined()
  })

  it.each([401, 403])('rejects provider auth rejection %s despite inert nonempty credentials', async status => {
    networkReply({ error: SENSITIVE }, status)
    await expect(verifyAccountConnection(requestFor(kind))).rejects.toThrow(RETRY)
    expect(network).toHaveBeenCalled()
  })

  it('rejects missing credentials without any network call', async () => {
    files.readFile.mockRejectedValue(new Error(SENSITIVE))
    const request = { ...requestFor(kind), resolveCredential: async () => '', readCopilotCredential: async () => undefined }
    await expect(verifyAccountConnection(request)).rejects.toThrow(RETRY)
    expect(network).not.toHaveBeenCalled()
  })

  it('sanitizes provider network errors', async () => {
    network.mockRejectedValue(new Error(SENSITIVE))
    await expect(verifyAccountConnection(requestFor(kind))).rejects.toThrow(RETRY)
  })

  it.each([429, 500])('does not mistake transient HTTP %s for authenticated exhausted quota', async status => {
    networkReply({ error: SENSITIVE }, status)
    await expect(verifyAccountConnection(requestFor(kind))).rejects.toThrow(RETRY)
  })

  it('rejects unsupported 200 metadata rather than guessing authentication', async () => {
    networkReply({})
    await expect(verifyAccountConnection(requestFor(kind))).rejects.toThrow(RETRY)
  })

  it('checks cancellation before any credential or provider work', async () => {
    const controller = new AbortController()
    controller.abort(new Error(SENSITIVE))
    const request = { ...requestFor(kind), signal: controller.signal }
    await expect(verifyAccountConnection(request)).rejects.toThrow(RETRY)
    expect(request.resolveCredential).not.toHaveBeenCalled()
    expect(request.readCopilotCredential).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
    expect(files.readFile).not.toHaveBeenCalled()
    expect(files.keychain).not.toHaveBeenCalled()
  })

  it('forwards in-flight cancellation and cannot accept a late successful response', async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    network.mockImplementation(async (_url, init) => {
      if (init?.signal !== undefined && init.signal !== null) signals.push(init.signal)
      controller.abort(new Error(SENSITIVE))
      return new Response(JSON.stringify(successfulBody(kind)))
    })
    await expect(verifyAccountConnection({ ...requestFor(kind), signal: controller.signal })).rejects.toThrow(RETRY)
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })
})

describe('keyed Claude metadata (never CLI auth or inference)', () => {
  it('records Claude connection verification through the provider helper without token or request content', async () => {
    using recorder = recordSpans()
    networkReply({ input_tokens: 3 })
    await verifyAccountConnection({ ...requestFor('claude', true), resolveCredential: async () => 'private-claude-key' })
    const span = recorder.span('ai-accounts provider request')
    expect(span.attributes).toEqual({
      'dshx.ai-accounts.provider': 'claude',
      'dshx.ai-accounts.operation': 'verification',
      'server.address': 'api.anthropic.com',
      'http.response.status_code': 200,
    })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toMatch(/private-claude-key|Connection check|count_tokens|claude-sonnet/)
  })
  it.each([
    ['synthetic-api-key', 'x-api-key'],
    ['sk-ant-oat-synthetic-setup-token', 'authorization'],
  ])('verifies %s with the installed transport auth header %s', async (key, header) => {
    networkReply({ input_tokens: 3 })
    await expect(verifyAccountConnection({ ...requestFor('claude', true), resolveCredential: async () => key })).resolves.toBeUndefined()
    expect(network).toHaveBeenCalledExactlyOnceWith(
      'https://api.anthropic.com/v1/messages/count_tokens',
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    )
    const init = network.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get(header)).toBe(header === 'authorization' ? `Bearer ${key}` : key)
    expect(headers.get(header === 'authorization' ? 'x-api-key' : 'authorization')).toBeNull()
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'Connection check' }] })
    expect(files.readFile).not.toHaveBeenCalled()
    expect(files.keychain).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 500])('rejects HTTP %s with no fallback to a valid CLI login', async status => {
    networkReply({ error: SENSITIVE }, status)
    await expect(verifyAccountConnection(requestFor('claude', true))).rejects.toThrow(RETRY)
    expect(files.readFile).not.toHaveBeenCalled()
    expect(files.keychain).not.toHaveBeenCalled()
  })

  it('rejects missing named key instead of using an existing CLI subscription', async () => {
    await expect(verifyAccountConnection({ ...requestFor('claude', true), resolveCredential: async () => '' })).rejects.toThrow(RETRY)
    expect(network).not.toHaveBeenCalled()
    expect(files.readFile).not.toHaveBeenCalled()
    expect(files.keychain).not.toHaveBeenCalled()
  })

  it.each([{}, { input_tokens: -1 }, { input_tokens: '3' }, { input_tokens: null }, { data: [] }])('rejects unsupported metadata %j', async body => {
    networkReply(body)
    await expect(verifyAccountConnection(requestFor('claude', true))).rejects.toThrow(RETRY)
  })

  it('sanitizes a keyed metadata network failure', async () => {
    network.mockRejectedValue(new Error(SENSITIVE))
    await expect(verifyAccountConnection(requestFor('claude', true))).rejects.toThrow(RETRY)
  })

  it('checks cancellation before resolving a keyed credential', async () => {
    const controller = new AbortController()
    controller.abort(new Error(SENSITIVE))
    const request = { ...requestFor('claude', true), signal: controller.signal }
    await expect(verifyAccountConnection(request)).rejects.toThrow(RETRY)
    expect(request.resolveCredential).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
  })

  it('forwards keyed metadata cancellation without accepting a late success', async () => {
    const controller = new AbortController()
    let probeSignal: AbortSignal | null | undefined
    network.mockImplementation(async (_url, init) => {
      probeSignal = init?.signal
      controller.abort(new Error(SENSITIVE))
      return new Response(JSON.stringify({ input_tokens: 3 }))
    })
    await expect(verifyAccountConnection({ ...requestFor('claude', true), signal: controller.signal })).rejects.toThrow(RETRY)
    expect(probeSignal?.aborted).toBe(true)
  })

  it('bounds keyed metadata even when its transport ignores cancellation', async () => {
    vi.useFakeTimers()
    let probeSignal: AbortSignal | null | undefined
    network.mockImplementation(async (_url, init) => {
      probeSignal = init?.signal
      return new Promise(() => {})
    })
    const pending = expect(verifyAccountConnection(requestFor('claude', true))).rejects.toThrow(RETRY)
    await vi.advanceTimersByTimeAsync(6_000)
    await pending
    expect(probeSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a loopback metadata base because inference still uses the official origin', async () => {
    networkReply({ input_tokens: 3 })
    const request = requestFor('claude', true)
    await expect(verifyAccountConnection({ ...request, account: { ...request.account, apiBaseUrl: 'http://127.0.0.1:12345' } })).rejects.toThrow(RETRY)
    expect(network).not.toHaveBeenCalled()
  })

  it.each([
    'https://untrusted.invalid',
    'https://api.anthropic.com@untrusted.invalid',
    'http://api.anthropic.com',
    'https://api.anthropic.com:444',
    'https://api.anthropic.com/path',
    'https://api.anthropic.com?key=secret',
  ])('refuses unsafe override %s before sending a credential', async apiBaseUrl => {
    const request = requestFor('claude', true)
    await expect(verifyAccountConnection({ ...request, account: { ...request.account, apiBaseUrl } })).rejects.toThrow(RETRY)
    expect(network).not.toHaveBeenCalled()
  })
})

describe('fresh subscription and exact credential ownership', () => {
  it('rejects an expired official Claude CLI login without a network request', async () => {
    files.readFile.mockResolvedValue(JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-access', expiresAt: 1 } }))
    await expect(verifyAccountConnection(requestFor('claude'))).rejects.toThrow(RETRY)
    expect(network).not.toHaveBeenCalled()
  })

  it('does not trust the ordinary Claude cache after the credential becomes invalid', async () => {
    const cached = vi.spyOn(claudeAccountService, 'readUsage').mockResolvedValue({
      ...ProviderUsageModel.emptyUsage('ok'),
      windows: [{ label: 'Weekly', percentRemaining: 50, resetsAt: null }],
    })
    try {
      networkReply({}, 401)
      await expect(verifyAccountConnection(requestFor('claude'))).rejects.toThrow(RETRY)
      expect(cached).toHaveBeenCalledTimes(1)
      expect(network).not.toHaveBeenCalled()
    } finally {
      cached.mockRestore()
    }
  })

  it.each(['commandcode', 'cursor'] as const)('does not fall back to OS auth for an empty configured %s credential', async kind => {
    await expect(verifyAccountConnection({ ...requestFor(kind), resolveCredential: async () => '' })).rejects.toThrow(RETRY)
    expect(files.readFile).not.toHaveBeenCalled()
    expect(files.keychain).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
  })

  it('preserves explicit blank-reference Command Code CLI login and still probes usage', async () => {
    files.readFile.mockImplementation(async path => {
      if (String(path) === '/synthetic/.commandcode/auth.json') return JSON.stringify({ apiKey: 'synthetic-cli-key' })
      throw new Error('No synthetic file')
    })
    networkReply(successfulBody('commandcode'))
    const request = requestFor('commandcode')
    await verifyAccountConnection({
      ...request,
      method: 'cli',
      account: { ...request.account, apiKeyEnv: '' },
      resolveCredential: async () => 'unrelated-default-key',
    })
    expect(files.readFile).toHaveBeenCalledWith('/synthetic/.commandcode/auth.json', 'utf8')
    expect(network).toHaveBeenCalled()
  })

  it('preserves explicit blank-reference Cursor CLI login and still probes quota only', async () => {
    files.keychain.mockResolvedValue(cursorToken)
    networkReply(successfulBody('cursor'))
    const request = requestFor('cursor')
    await verifyAccountConnection({
      ...request,
      method: 'cli',
      account: { ...request.account, apiKeyEnv: '' },
      resolveCredential: async () => 'unrelated-default-key',
    })
    expect(files.keychain).toHaveBeenCalledWith({ service: 'cursor-access-token', account: 'cursor-user' })
    expect(network).toHaveBeenCalledExactlyOnceWith('https://cursor.com/api/usage-summary', expect.objectContaining({ redirect: 'error' }))
  })

  it('uses one resolved key throughout the attempt rather than re-reading a changed credential', async () => {
    networkReply(successfulBody('opencode-go'))
    const resolveCredential = vi.fn().mockResolvedValueOnce('synthetic-first-key').mockResolvedValue('synthetic-second-key')
    await verifyAccountConnection({ ...requestFor('opencode-go'), resolveCredential })
    expect(resolveCredential).toHaveBeenCalledTimes(1)
    expect(new Headers(network.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer synthetic-first-key')
  })
})

describe.each(kinds)('%s injected owned adapter contract and bounds', kind => {
  it('forwards the existing account usage inputs and accepts zero remaining quota', async () => {
    const request = requestFor(kind)
    const adapter = vi.fn<typeof readAccountUsage>().mockImplementation(async input => {
      input.onAuthenticated?.()
      return { ...ProviderUsageModel.emptyUsage('ok'), windows: [{ label: 'Weekly', percentRemaining: 0, resetsAt: null }] }
    })
    await verifyAccountConnection({ ...request, readAccountUsage: adapter })
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        account: request.account,
        shadowRoot: request.shadowRoot,
        readCopilotCredential: request.readCopilotCredential,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(network).not.toHaveBeenCalled()
    expect(files.readFile).not.toHaveBeenCalled()
    expect(files.keychain).not.toHaveBeenCalled()
  })

  it.each(['unauthenticated', 'error', 'rate-limited', 'unsupported'] as const)('rejects %s even if the card includes quota', async status => {
    const adapter: typeof readAccountUsage = async () => ({
      ...ProviderUsageModel.emptyUsage(status, SENSITIVE),
      windows: [{ label: 'Weekly', percentRemaining: 50, resetsAt: null }],
    })
    await expect(verifyAccountConnection({ ...requestFor(kind), readAccountUsage: adapter })).rejects.toThrow(RETRY)
  })

  it('discards stale success and raw adapter messages', async () => {
    const adapter: typeof readAccountUsage = async () => ({
      ...ProviderUsageModel.emptyUsage('ok', SENSITIVE),
      windows: [{ label: 'Weekly', percentRemaining: 50, resetsAt: null }],
    })
    await expect(verifyAccountConnection({ ...requestFor(kind), readAccountUsage: adapter })).rejects.toThrow(RETRY)
  })

  it('does not leak an arbitrary thrown value or attach a raw cause', async () => {
    const adapter: typeof readAccountUsage = async () => {
      throw new Error(SENSITIVE)
    }
    const error = await verifyAccountConnection({ ...requestFor(kind), readAccountUsage: adapter }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: RETRY })
    expect(error).not.toHaveProperty('cause')
    expect(String(error)).not.toContain(SENSITIVE)
  })

  it('bounds an adapter which ignores cancellation to six seconds', async () => {
    vi.useFakeTimers()
    let probeSignal: AbortSignal | undefined
    const adapter: typeof readAccountUsage = async input => {
      probeSignal = input.signal
      return new Promise(() => {})
    }
    const pending = expect(verifyAccountConnection({ ...requestFor(kind), readAccountUsage: adapter })).rejects.toThrow(RETRY)
    await vi.advanceTimersByTimeAsync(6_000)
    await pending
    expect(probeSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a late success when the injected adapter aborts its caller', async () => {
    const controller = new AbortController()
    const adapter: typeof readAccountUsage = async () => {
      controller.abort(new Error(SENSITIVE))
      return { ...ProviderUsageModel.emptyUsage('ok'), windows: [{ label: 'Weekly', percentRemaining: 50, resetsAt: null }] }
    }
    await expect(verifyAccountConnection({ ...requestFor(kind), signal: controller.signal, readAccountUsage: adapter })).rejects.toThrow(RETRY)
  })
})

it.each([
  ['codex', { plan_type: 'pro', rate_limit: null }],
  ['github-copilot', { copilot_plan: 'business', quota_snapshots: { premium_interactions: { unlimited: true, percent_remaining: 100 } } }],
  ['commandcode', { windowLimits: null, credits: { planId: 'individual-pro', monthlyCredits: null } }],
  ['cursor', { membershipType: 'pro', individualUsage: { plan: { enabled: false } } }],
  ['claude', { five_hour: null, seven_day: null }],
  ['opencode-go', { usage: { rolling: null, weekly: null } }],
  ['github-copilot', { copilot_plan: 'business', quota_snapshots: { premium_interactions: { unlimited: true } } }],
  ['cursor', { individualUsage: { plan: null } }],
] as const)('admits authenticated %s without displayed quota windows', async (kind, body) => {
  networkReply(body)
  await expect(verifyAccountConnection(requestFor(kind))).resolves.toBeUndefined()
})

describe('exact credential ownership persists after admission', () => {
  it('reads only the explicit Command Code CLI file despite a valid default key', async () => {
    files.readFile.mockResolvedValue(JSON.stringify({ apiKey: 'synthetic-cli-key' }))
    const resolver = vi.fn(async () => 'synthetic-default-key')
    expect(await readCommandCodeKey('COMMANDCODE_API_KEY', resolver, 'cli')).toBe('synthetic-cli-key')
    expect(resolver).not.toHaveBeenCalled()
    expect(files.readFile).toHaveBeenCalledWith('/synthetic/.commandcode/auth.json', 'utf8')
  })

  it('does not let a missing named Command Code reference fall back to CLI', async () => {
    expect(await readCommandCodeKey('SYNTHETIC_API_KEY', async () => '', 'reference')).toBe('')
    expect(files.readFile).not.toHaveBeenCalled()
  })

  it('uses Cursor CLI login without resolving a named environment key', async () => {
    files.keychain.mockResolvedValue(cursorToken)
    const resolver = vi.fn(async () => 'unrelated-key')
    expect(await readCursorToken('CURSOR_API_KEY', resolver, 'cli')).toBe(cursorToken)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('does not let a missing Cursor reference fall back to keychain or CLI file', async () => {
    expect(await readCursorToken('SYNTHETIC_API_KEY', async () => '', 'reference')).toBeUndefined()
    expect(files.keychain).not.toHaveBeenCalled()
    expect(files.readFile).not.toHaveBeenCalled()
  })
})

it.each(kinds)('rejects an ok %s card without fresh private proof', async kind => {
  await expect(verifyAccountConnection({ ...requestFor(kind), readAccountUsage: async () => ProviderUsageModel.emptyUsage('ok') })).rejects.toThrow(RETRY)
})

it('accepts official native Claude CLI configuration proof without inspecting expired quota credentials', async () => {
  files.readFile.mockRejectedValue(new Error('No synthetic stored credentials'))
  const runClaudeAuthStatus = vi.fn(async () => ({ exitCode: 0, stdout: '{"loggedIn":true,"authMethod":"oauth_token"}' }))
  const request = requestFor('claude', true)
  await verifyAccountConnection({ ...request, account: { ...request.account, apiKeyEnv: '' }, method: 'subscription', runClaudeAuthStatus })
  expect(runClaudeAuthStatus).toHaveBeenCalledOnce()
  expect(files.readFile).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
})

it.each([0, 3])('raw Claude setup token uses free count_tokens with no CLI dependency (%s)', async input_tokens => {
  networkReply({ input_tokens })
  const runClaudeAuthStatus = vi.fn(async () => {
    throw new Error('CLI must not run')
  })
  await verifyAccountConnection({ ...requestFor('claude', true), resolveCredential: async () => 'sk-ant-oat-synthetic', runClaudeAuthStatus })
  expect(runClaudeAuthStatus).not.toHaveBeenCalled()
  expect(network).toHaveBeenCalledExactlyOnceWith('https://api.anthropic.com/v1/messages/count_tokens', expect.objectContaining({ method: 'POST' }))
})

it.each([401, 403])('denied setup-token count scope %s neither falls back to CLI nor paid inference', async status => {
  networkReply({ error: SENSITIVE }, status)
  const runClaudeAuthStatus = vi.fn(async () => ({ exitCode: 0, stdout: '{"loggedIn":true}' }))
  await expect(
    verifyAccountConnection({ ...requestFor('claude', true), resolveCredential: async () => 'sk-ant-oat-synthetic', runClaudeAuthStatus }),
  ).rejects.toThrow(RETRY)
  expect(runClaudeAuthStatus).not.toHaveBeenCalled()
  expect(network).toHaveBeenCalledTimes(1)
})

it('bounds a hanging credential resolver before starting any probe', async () => {
  vi.useFakeTimers()
  const adapter = vi.fn<typeof readAccountUsage>()
  const pending = expect(
    verifyAccountConnection({ ...requestFor('opencode-go'), resolveCredential: async () => new Promise(() => {}), readAccountUsage: adapter }),
  ).rejects.toThrow(RETRY)
  await vi.advanceTimersByTimeAsync(6_000)
  await pending
  expect(adapter).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the whole-operation timer on success', async () => {
  vi.useFakeTimers()
  const adapter: typeof readAccountUsage = async input => {
    input.onAuthenticated?.()
    return ProviderUsageModel.emptyUsage('unsupported')
  }
  await verifyAccountConnection({ ...requestFor('opencode-go'), readAccountUsage: adapter })
  expect(vi.getTimerCount()).toBe(0)
})
