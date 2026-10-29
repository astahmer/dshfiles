import { describe, expect, it, vi } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials'
import { AccountDraftModel } from './account-draft.js'
import { ClaudeAccountModel } from './claude-account.js'
import type { AccountDraft } from './api.js'
import type { AccountStoreFile } from './account-store.js'
import { CodexHomeModel } from './codex-home.js'
import { join } from 'node:path'
import { AccountLogoutProcess, createAccountSessionService, type AccountSessionFiles } from './account-session-service.js'

const profile = (kind: AccountDraft['kind'] = 'codex'): AccountDraft => ({
  ...AccountDraftModel.newAccountDraft({ kind, existing: [] }),
  instanceId: 'synthetic',
  displayName: 'Synthetic Work',
  homePath: join(CodexHomeModel.accountHome(), 'synthetic-session-shared'),
  shadowHomePath: join(CodexHomeModel.accountHome(), 'synthetic-session-private'),
  apiKeyEnv: '',
})
const fixture = (account = profile()) => {
  const file: AccountStoreFile = {
    distribution: 'sticky',
    cooldownMs: 1234,
    shadowRoot: join(CodexHomeModel.accountHome(), 'synthetic-shadows'),
    accounts: [account],
  }
  let info: CredentialInfo = { configured: true, source: 'file', writable: true }
  const credentials = {
    describe: vi.fn(async () => info),
    unset: vi.fn(async () => {
      info = { configured: false, writable: true }
    }),
    describeRecord: vi.fn(async () => ({ configured: true, writable: true })),
  }
  const files: AccountSessionFiles = {
    validateCodex: vi.fn(async () => undefined),
    finishCodexLogout: vi.fn(async () => undefined),
    validateClaude: vi.fn(async () => undefined),
    isClaudeSignedIn: vi.fn(async () => false),
  }
  const run = vi.fn(async () => 0)
  const copilot = { writable: vi.fn(async () => true), signOut: vi.fn(async () => undefined) }
  const onSignedOut = vi.fn(async () => undefined)
  const isBusy = vi.fn(() => false)
  const options = {
    readAccounts: vi.fn(async () => file),
    credentials,
    files,
    run,
    copilot,
    onSignedOut,
    isBusy,
    environment: { PATH: '/synthetic/bin', HOME: '/synthetic/user', OPENAI_API_KEY: 'fixture-env-not-a-secret', CLAUDE_CODE_OAUTH_TOKEN: '' },
    executableAvailable: vi.fn(async () => true),
  }
  return {
    file,
    account,
    credentials,
    files,
    run,
    copilot,
    onSignedOut,
    isBusy,
    options,
    setInfo: (next: CredentialInfo) => {
      info = next
    },
    service: createAccountSessionService(options),
  }
}
const request = { instanceId: 'synthetic', confirm: true } as const

describe('account sign-out service ownership', () => {
  it('records account sign out through credential completion without account names, homes or credentials', async () => {
    using recorder = recordSpans()
    const f = fixture()
    f.onSignedOut.mockImplementation(async () => {
      expect(recorder.named('account sign out')).toHaveLength(0)
    })
    await expect(f.service.signOut(request)).resolves.toEqual({ signedOut: true })
    const span = recorder.span('account sign out')
    expect(span.attributes).toEqual({
      'dshx.ai-accounts.operation': 'sign-out',
      'dshx.ai-accounts.provider': 'codex',
      'dshx.ai-accounts.credential_store': 'codex',
    })
    expect(span.status.code).not.toBe('error')
    expect(recorder.named('account sign out')).toHaveLength(1)
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toMatch(/synthetic|Synthetic|fixture-env|auth.json|cli_auth/)
  })
  it('records a failed logout without subprocess output, paths or external error messages', async () => {
    using recorder = recordSpans()
    const f = fixture()
    f.run.mockRejectedValue(new TypeError('synthetic-sensitive-path-and-token'))
    await expect(f.service.signOut(request)).rejects.toThrow('Could not sign out')
    const span = recorder.span('account sign out')
    expect(span.status).toEqual({ code: 'error', message: 'Error' })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('synthetic')
    expect(f.onSignedOut).not.toHaveBeenCalled()
  })
  it('uses official Codex logout with exactly the effective private home and forced file storage; preserves every profile field', async () => {
    const f = fixture()
    const before = JSON.stringify(f.file)
    const capability = await f.service.capability('synthetic')
    expect(capability).toMatchObject({ available: true, reason: null })
    expect(capability.credentialScope).toContain(f.account.shadowHomePath)
    expect(f.run).not.toHaveBeenCalled()
    expect(await f.service.signOut(request)).toEqual({ signedOut: true })
    expect(f.run).toHaveBeenCalledWith({
      executable: 'codex',
      args: ['-c', 'cli_auth_credentials_store="file"', 'logout'],
      home: f.account.shadowHomePath,
      env: { PATH: '/synthetic/bin', HOME: '/synthetic/user', CODEX_HOME: f.account.shadowHomePath, NO_COLOR: '1', TERM: 'dumb' },
    })
    expect(f.files.finishCodexLogout).toHaveBeenCalledWith(expect.objectContaining({ effectiveHomePath: f.account.shadowHomePath }))
    expect(f.credentials.unset).not.toHaveBeenCalled()
    expect(f.onSignedOut).toHaveBeenCalledOnce()
    expect(JSON.stringify(f.file)).toBe(before)
  })
  it('supports explicit Claude directory auth logout, not a default ambient CLI environment', async () => {
    const f = fixture(profile('claude'))
    expect(await f.service.signOut(request)).toEqual({ signedOut: true })
    expect(f.run).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: 'claude',
        args: ['auth', 'logout'],
        home: f.account.homePath,
        env: expect.objectContaining({ CLAUDE_CONFIG_DIR: f.account.homePath }),
      }),
    )
    expect(f.files.isClaudeSignedIn).toHaveBeenCalledWith(f.account.homePath)
  })
  it('removes only an account-private native stored reference; never rewrites the account or reads its value', async () => {
    const f = fixture({ ...profile('opencode-go'), authSource: 'reference', apiKeyEnv: `CONNECTION_${'A'.repeat(32)}_API_KEY` })
    const before = JSON.stringify(f.file)
    await f.service.signOut(request)
    expect(f.credentials.unset).toHaveBeenCalledWith(f.account.apiKeyEnv)
    expect(f.run).not.toHaveBeenCalled()
    expect(JSON.stringify(f.file)).toBe(before)
  })
  it('uses the existing account-owned Copilot service', async () => {
    const f = fixture(profile('github-copilot'))
    await f.service.signOut(request)
    expect(f.copilot.signOut).toHaveBeenCalledWith('synthetic')
    expect(f.run).not.toHaveBeenCalled()
  })
  it.each(['commandcode', 'cursor'] as const)('refuses global-only %s CLI logout with a manual action', async kind => {
    const f = fixture({ ...profile(kind), authSource: 'cli' })
    expect(await f.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('shared global CLI') })
    await expect(f.service.signOut(request)).rejects.toThrow('manually')
    expect(f.run).not.toHaveBeenCalled()
  })
  it.each(['env', 'project-env', 'user-env', 'secret-catalog'])('refuses externally supplied %s references even if the provider can write', async source => {
    const f = fixture({ ...profile('opencode-go'), authSource: 'reference', apiKeyEnv: `CONNECTION_${'B'.repeat(32)}_API_KEY` })
    f.setInfo({ configured: true, source, writable: true })
    expect(await f.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('external') })
    await expect(f.service.signOut(request)).rejects.toThrow('external')
    expect(f.credentials.unset).not.toHaveBeenCalled()
  })
  it('does not treat an arbitrary writable API-key reference as owned', async () => {
    const f = fixture({ ...profile('opencode-go'), authSource: 'reference', apiKeyEnv: 'WORK_API_KEY' })
    expect(await f.service.capability('synthetic')).toMatchObject({ available: false })
    expect(f.credentials.describe).not.toHaveBeenCalled()
    expect(f.credentials.unset).not.toHaveBeenCalled()
  })
  it('refuses references shared by another profile', async () => {
    const account = { ...profile('opencode-go'), authSource: 'reference' as const, apiKeyEnv: `CONNECTION_${'A'.repeat(32)}_API_KEY` }
    const f = fixture(account)
    f.options.readAccounts.mockResolvedValue({ ...f.file, accounts: [account, { ...account, instanceId: 'second' }] })
    expect(await f.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('shared') })
  })
  it('refuses a default/unowned Codex home and a credential home shared with another profile', async () => {
    const f = fixture({
      ...profile(),
      shadowHomePath: join(CodexHomeModel.accountHome(), '.codex'),
      homePath: join(CodexHomeModel.accountHome(), 'synthetic-shared'),
    })
    expect(await f.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('shared') })
    const g = fixture()
    g.options.readAccounts.mockResolvedValue({ ...g.file, accounts: [g.account, { ...g.account, instanceId: 'second' }] })
    expect(await g.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('shared') })
    expect(g.run).not.toHaveBeenCalled()
  })
  it('refuses unsafe Codex paths and missing official CLI without attempting logout or installing anything', async () => {
    const f = fixture()
    vi.mocked(f.files.validateCodex).mockRejectedValue(new Error('unsafe synthetic path'))
    expect(await f.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('validated private') })
    const g = fixture()
    g.options.executableAvailable.mockResolvedValue(false)
    expect(await g.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('not installed') })
    expect(g.run).not.toHaveBeenCalled()
  })
  it('refuses the Host CLAUDE_CODE_OAUTH_TOKEN and does not pretend CLI logout can remove it', async () => {
    const f = fixture(profile('claude'))
    const service = createAccountSessionService({ ...f.options, environment: { CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-external-token' } })
    expect(await service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('CLAUDE_CODE_OAUTH_TOKEN') })
    await expect(service.signOut(request)).rejects.toThrow('externally')
    expect(f.run).not.toHaveBeenCalled()
  })
  it('refuses active provisional setup, staged login or replacement work without cancelling it', async () => {
    const f = fixture()
    f.isBusy.mockReturnValue(true)
    expect(await f.service.capability('synthetic')).toMatchObject({ available: false, reason: expect.stringContaining('active account connection') })
    await expect(f.service.signOut(request)).rejects.toThrow('active account connection')
    expect(f.run).not.toHaveBeenCalled()
    expect(f.copilot.signOut).not.toHaveBeenCalled()
  })
  it('rechecks active work after asynchronous capability validation', async () => {
    const f = fixture()
    f.isBusy.mockReturnValueOnce(false).mockReturnValue(true)
    await expect(f.service.signOut(request)).rejects.toThrow('active account connection')
    expect(f.run).not.toHaveBeenCalled()
  })
  it('redacts subprocess failures and never creates a tombstone after unsuccessful logout', async () => {
    const f = fixture()
    f.run.mockRejectedValue(new Error('synthetic-sensitive-output'))
    await expect(f.service.signOut(request)).rejects.toThrow('Could not sign out')
    await expect(f.service.signOut(request)).rejects.not.toThrow('synthetic-sensitive-output')
    expect(f.files.finishCodexLogout).not.toHaveBeenCalled()
    expect(f.onSignedOut).not.toHaveBeenCalled()
  })
  it('does not claim success when a native fallback remains configured', async () => {
    const f = fixture({ ...profile('opencode-go'), authSource: 'reference', apiKeyEnv: `CONNECTION_${'A'.repeat(32)}_API_KEY` })
    f.credentials.unset.mockImplementation(async () => undefined)
    await expect(f.service.signOut(request)).rejects.toThrow('Could not sign out')
    expect(f.onSignedOut).not.toHaveBeenCalled()
  })
  it('revalidates Codex ownership after planning and refuses the CLI when the home changes', async () => {
    const f = fixture()
    vi.mocked(f.files.validateCodex).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('synthetic changed owner'))
    await expect(f.service.signOut(request)).rejects.toThrow('Could not sign out')
    expect(f.run).not.toHaveBeenCalled()
  })
  it('checks both Claude credential/config files again after the CLI before announcing success', async () => {
    const f = fixture(profile('claude'))
    vi.mocked(f.files.validateClaude)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('synthetic replaced configuration'))
    await expect(f.service.signOut(request)).rejects.toThrow('Could not sign out')
    expect(f.run).toHaveBeenCalledOnce()
    expect(f.onSignedOut).not.toHaveBeenCalled()
  })
  it('does not forward credentials, loader variables or inherited provider-home overrides to a CLI', () => {
    expect(
      AccountLogoutProcess.environment(
        {
          PATH: '/bin',
          HOME: '/synthetic',
          CODEX_HOME: '/wrong',
          CLAUDE_CONFIG_DIR: '/wrong',
          NODE_OPTIONS: '--require /untrusted',
          OPENAI_API_KEY: 'fake',
          ANTHROPIC_API_KEY: 'fake',
          CLAUDE_CODE_OAUTH_TOKEN: 'fake',
        },
        'codex',
        '/selected',
      ),
    ).toEqual({ PATH: '/bin', HOME: '/synthetic', CODEX_HOME: '/selected', NO_COLOR: '1', TERM: 'dumb' })
    expect(AccountLogoutProcess.environment({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/wrong' }, 'claude', '/selected')).toEqual({
      PATH: '/bin',
      CLAUDE_CONFIG_DIR: '/selected',
      NO_COLOR: '1',
      TERM: 'dumb',
    })
    expect(AccountLogoutProcess.environment({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/wrong' }, 'claude', ClaudeAccountModel.resolveClaudeConfigDir(''))).toEqual({
      PATH: '/bin',
      NO_COLOR: '1',
      TERM: 'dumb',
    })
  })
})
