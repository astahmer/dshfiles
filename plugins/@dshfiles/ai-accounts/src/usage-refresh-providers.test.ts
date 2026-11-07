import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { aiAccountsQueries } from './accounts-queries.js'
import type { AccountKind, AccountProfile, AccountsUsage, UsageCard } from './api.js'
import { ProviderUsageModel, readCodexUsage } from './usage.js'

/** The real read of every provider, down to its fetch, answering a sweep the way the page will merge it. */
const jwt = (payload: { readonly sub: string }): string => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`
const CONFIG_ROOT = mkdtempSync(join(tmpdir(), 'usage-refresh-'))

let answer: () => Response = () => new Response('{}', { status: 502 })
const requested: string[] = []
let readAccountUsage: typeof import('./account-usage.js').readAccountUsage

const profile = (kind: AccountKind, overrides: Partial<AccountProfile> = {}): AccountProfile => ({
  ...AccountDraftModel.newAccountDraft({ kind, existing: [] }),
  mode: 'direct',
  signedIn: true,
  identity: null,
  plan: null,
  state: 'healthy',
  loginHint: '',
  detail: null,
  authSource: 'reference',
  apiKeyEnv: 'SYNTHETIC_KEY',
  ...overrides,
})

const claudeHome = join(CONFIG_ROOT, 'claude')
const codexHome = join(CONFIG_ROOT, 'codex')

const lastGood: UsageCard = {
  status: 'ok',
  message: null,
  identity: null,
  plan: null,
  windows: [{ label: 'Weekly limit', percentRemaining: 40, resetsAt: null }],
  bankedResets: 0,
  bankedResetExpiries: [],
  readAt: 1_000,
}

const read = (account: AccountProfile): Promise<UsageCard> => {
  // The account home policy only admits homes under the OS home, which a test must not write to.
  if (account.kind === 'codex') return readCodexUsage(codexHome)
  const token = account.kind === 'cursor' ? jwt({ sub: 'auth0|synthetic' }) : 'synthetic-key'
  return readAccountUsage({
    account,
    shadowRoot: join(CONFIG_ROOT, 'shadows'),
    resolveCredential: async () => token,
    readCopilotCredential: async () => ({ type: 'oauth', access: 'synthetic', refresh: 'synthetic-github', expires: Number.MAX_SAFE_INTEGER }),
  })
}

const PROVIDERS: readonly (readonly [AccountKind, () => AccountProfile])[] = [
  ['codex', () => profile('codex')],
  ['claude', () => profile('claude', { homePath: claudeHome, authSource: 'cli' })],
  ['opencode-go', () => profile('opencode-go')],
  ['commandcode', () => profile('commandcode')],
  ['github-copilot', () => profile('github-copilot')],
  ['cursor', () => profile('cursor')],
  ['mistral', () => profile('mistral')],
]

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    requested.push(String(url))
    return answer()
  })
  mkdirSync(claudeHome, { recursive: true })
  writeFileSync(
    join(claudeHome, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-test', refreshToken: 'r', expiresAt: 9_999_999_999_999 } }),
  )
  mkdirSync(codexHome, { recursive: true })
  writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({ tokens: { access_token: 'synthetic', account_id: 'synthetic' } }))
  // The Claude service binds `fetch` on import, so the module loads after the stub.
  ;({ readAccountUsage } = await import('./account-usage.js'))
})

afterAll(() => {
  vi.unstubAllGlobals()
  rmSync(CONFIG_ROOT, { recursive: true, force: true })
})

beforeEach(() => {
  requested.length = 0
  answer = () => new Response('{}', { status: 502 })
})

describe('a failed provider read during a refresh', () => {
  it.each(PROVIDERS)('%s reaches its provider, reports why, and keeps its last reading with its own time', async (kind, account) => {
    const failed = ProviderUsageModel.stamped(await read(account()), 2_000)

    expect(requested.length).toBeGreaterThan(0)
    expect(failed.status).toBe('error')
    expect(failed.message).toBeTruthy()
    expect(failed.readAt).toBe(2_000)

    const sweep = (usage: UsageCard, readAt: number): AccountsUsage => ({
      readAt,
      hostName: 'synthetic-host',
      cards: [{ instanceId: 'work', displayName: 'Work', kind, enabled: true, usage }],
    })
    const merged = aiAccountsQueries.keepLastGoodUsage(sweep(lastGood, 1_000), sweep(failed, 2_000))
    expect(merged?.readAt).toBe(2_000)
    expect(merged?.cards[0]?.usage).toMatchObject({
      status: 'ok',
      windows: lastGood.windows,
      readAt: 1_000,
      readFailure: { status: 'error', message: failed.message },
    })
  })
})

describe('a dated reading', () => {
  it('keeps the read time a provider already gave and dates the rest with the sweep', () => {
    expect(ProviderUsageModel.stamped(lastGood, 2_000).readAt).toBe(1_000)
    expect(ProviderUsageModel.stamped(ProviderUsageModel.emptyUsage('error', 'x'), 2_000).readAt).toBe(2_000)
  })
})
