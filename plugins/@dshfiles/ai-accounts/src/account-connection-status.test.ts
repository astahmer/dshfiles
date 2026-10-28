import { describe, expect, it } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { accountProfileSchema, accountsUsageSchema } from './api.js'
import { accountAuthenticationLabel, accountConnectionStatus } from './account-connection-status.js'

const account = accountProfileSchema.parse({
  ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
  instanceId: 'codex_work',
  displayName: 'Work',
  signedIn: true,
  identity: null,
  plan: null,
  mode: 'direct',
  state: 'healthy',
  loginHint: '',
  detail: null,
})
const quota = (instanceId: string, status: 'ok' | 'unauthenticated') =>
  accountsUsageSchema.parse({
    readAt: 1234,
    hostName: 'synthetic-host',
    cards: [
      {
        instanceId,
        displayName: 'Work',
        kind: 'codex',
        enabled: true,
        usage: {
          status,
          identity: 'synthetic-account',
          message: status === 'ok' ? 'Authenticated quota response' : 'Rejected credentials',
          windows: [],
          plan: null,
          bankedResets: 0,
          bankedResetExpiries: [],
        },
      },
    ],
  })

describe('reference dashboard observed authentication state', () => {
  it('never turns local credential presence into a token-validity or Connected claim', () => {
    expect(accountConnectionStatus(account, null)).toMatchObject({ label: 'Credentials available', authenticated: false, checkedAt: null })
    expect(accountConnectionStatus({ ...account, signedIn: false }, null).label).toBe('Not signed in')
  })
  it('uses only the selected account provider response and its observed reading time', () => {
    expect(accountConnectionStatus(account, quota('codex_work', 'ok'))).toMatchObject({ label: 'Connected', authenticated: true, checkedAt: 1234 })
    expect(accountConnectionStatus(account, quota('codex_work_extra', 'ok'))).toMatchObject({
      label: 'Credentials available',
      authenticated: false,
      checkedAt: null,
    })
  })
  it('provider authentication rejection takes precedence over saved credentials', () => {
    expect(accountConnectionStatus(account, quota('codex_work', 'unauthenticated'))).toMatchObject({
      label: 'Not signed in',
      authenticated: false,
      checkedAt: 1234,
    })
  })
  it('keeps an actual route cooldown visible despite an earlier healthy quota response', () => {
    expect(accountConnectionStatus({ ...account, state: 'cooling' }, quota('codex_work', 'ok'))).toMatchObject({
      label: 'Rate limited',
      tone: 'warning',
      authenticated: false,
    })
  })
  it('labels actual authentication choices without inventing identities', () => {
    expect(accountAuthenticationLabel(account)).toBe('ChatGPT (OAuth)')
    expect(accountAuthenticationLabel({ ...account, kind: 'claude', apiKeyEnv: 'secret:EXTERNAL' })).toBe('Credential reference')
    expect(accountAuthenticationLabel({ ...account, kind: 'commandcode', authSource: 'cli', apiKeyEnv: 'COMMANDCODE_API_KEY' })).toBe('CLI login')
  })
})
