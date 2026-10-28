import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateAccountRuntime } from './account-runtime.js'
import { createAccountLoginService, parseCodexDeviceInstructions, type AccountLoginAccount } from './account-login-service.js'
import type { CodexLoginFiles, LoginAuthSnapshot } from './codex-login-files.js'
import { CodexLoginUnsupported, type RunCodexLogin } from './codex-login-process.js'
import type { CodexHomeLayout } from './codex-home.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const layout: CodexHomeLayout = { mode: 'authOverlay', sharedHomePath: '/home/test/.codex', effectiveHomePath: '/home/test/.codex-dshx/work' }
const stage = { ...layout, effectiveHomePath: `${layout.effectiveHomePath}/.dsh-login-fake` }
const prompt =
  '\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code (expires in 15 minutes)\n   \x1b[94mABCD-EFGH\x1b[0m\n'
const emptyAuth: LoginAuthSnapshot = { signedIn: false, hasCredential: false, fingerprint: null }
const validAuth: LoginAuthSnapshot = { signedIn: true, hasCredential: true, fingerprint: 'fake-file-fingerprint' }
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.useRealTimers()
})

const harness = (
  options: {
    before?: LoginAuthSnapshot
    stageAuth?: LoginAuthSnapshot
    timeoutMs?: number
    kind?: string
    run?: RunCodexLogin
    deferAdoption?: boolean
    accountLookup?: () => Promise<AccountLoginAccount | undefined>
  } = {},
) => {
  const started = deferred<void>()
  const exit = deferred<number | null>()
  let emit: (text: string) => void = () => {
    throw new Error('Fake CLI has not started')
  }
  let signal: AbortSignal | undefined
  let account: AccountLoginAccount | undefined = { instanceId: 'work', kind: options.kind ?? 'codex', layout }
  const files: CodexLoginFiles = {
    prepare: vi.fn(async () => {}),
    auth: vi.fn(async home => (home === layout ? (options.before ?? emptyAuth) : (options.stageAuth ?? validAuth))),
    stage: vi.fn(async () => stage),
    adopt: vi.fn(() => true),
    cleanup: vi.fn(async () => {}),
  }
  const run = vi.fn<RunCodexLogin>(
    options.run ??
      (async input => {
        emit = input.onOutput
        signal = input.signal
        started.resolve()
        return exit.promise
      }),
  )
  const onComplete = vi.fn(async () => {})
  const service = createAccountLoginService({
    account: options.accountLookup ?? (async () => account),
    files,
    run,
    onComplete,
    deferAdoption: () => options.deferAdoption === true,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  cleanups.push(async () => {
    service.dispose()
    exit.resolve(null)
    await service.settled()
  })
  return {
    service,
    files,
    run,
    onComplete,
    started: started.promise,
    exit,
    emit: (text: string) => emit(text),
    aborted: () => signal?.aborted,
    account: (value: AccountLoginAccount | undefined) => {
      account = value
    },
  }
}

describe('official Codex device prompt parser', () => {
  it('strips ANSI and extracts only the pinned verification URL and short standalone code', () => {
    expect(parseCodexDeviceInstructions(prompt)).toEqual({ verificationUri: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGH' })
    expect(parseCodexDeviceInstructions(prompt.replace('ABCD-EFGH', 'ABCD-EFGHI'))?.userCode).toBe('ABCD-EFGHI')
  })
  it.each([
    'http://auth.openai.com/codex/device',
    'https://auth.openai.com.evil.test/codex/device',
    'https://auth.openai.com@evil.test/codex/device',
    'https://auth.openai.com/codex/device?token=never-return',
    'https://auth.openai.com:444/codex/device',
  ])('rejects noncanonical URL %s', url => {
    expect(() => parseCodexDeviceInstructions(prompt.replace('https://auth.openai.com/codex/device', url))).toThrow()
  })
  it('does not mistake tokens, codes in prose or incomplete lines for instructions', () => {
    expect(parseCodexDeviceInstructions(prompt.replace('ABCD-EFGH', 'raw-long-auth-token'))).toBeUndefined()
    expect(parseCodexDeviceInstructions(prompt.replace('2. Enter this one-time code', 'token'))).toBeUndefined()
    expect(parseCodexDeviceInstructions(prompt.slice(0, -1))).toBeUndefined()
  })
})

describe('managed Codex login with injected subprocess and filesystem', () => {
  it('is idempotent concurrently, runs only against fresh staging and adopts verified CLI auth', async () => {
    const h = harness()
    const [first, second] = await Promise.all([h.service.begin('work'), h.service.begin('work')])
    expect(first.status).toBe('starting')
    expect(second.status).toBe('starting')
    await h.started
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(h.run.mock.calls[0]?.[0].home).toBe(stage.effectiveHomePath)
    h.emit(prompt.slice(0, 50))
    h.emit(prompt.slice(50))
    expect(h.service.state('work')).toMatchObject({ status: 'waiting', userCode: 'ABCD-EFGH' })
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.files.adopt).toHaveBeenCalledWith(stage, layout, null)
    expect(h.onComplete).toHaveBeenCalledOnce()
    expect(h.files.cleanup).toHaveBeenCalledWith(stage)
    expect(h.service.state('work')).toMatchObject({ status: 'complete', userCode: null, verificationUri: null })
  })
  it.each(['cancel', 'reconcile', 'dispose'])('invalidates %s before an initial saved-account lookup resolves', async action => {
    const lookup = deferred<AccountLoginAccount | undefined>()
    const h = harness({ before: validAuth, accountLookup: () => lookup.promise })
    const beginning = h.service.begin('work', true)
    if (action === 'cancel') h.service.cancel('work')
    else if (action === 'reconcile') h.service.reconcile([])
    else h.service.dispose()
    lookup.resolve({ instanceId: 'work', kind: 'codex', layout })
    await beginning
    await h.service.settled()
    expect(h.files.prepare).not.toHaveBeenCalled()
    expect(h.run).not.toHaveBeenCalled()
    expect(h.files.adopt).not.toHaveBeenCalled()
  })
  it('retains successful CLI auth in private staging until connection verification accepts commit', async () => {
    const h = harness({ before: validAuth, deferAdoption: true })
    await h.service.begin('work', true)
    await h.started
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.service.state('work').status).toBe('complete')
    expect(h.service.pendingHome('work')).toBe(stage.effectiveHomePath)
    expect(h.files.adopt).not.toHaveBeenCalled()
    expect(h.files.cleanup).not.toHaveBeenCalled()
    await h.service.commitPending('work')
    expect(h.files.adopt).toHaveBeenCalledWith(stage, layout, validAuth.fingerprint)
    expect(h.files.cleanup).toHaveBeenCalledWith(stage)
    expect(h.service.pendingHome('work')).toBeUndefined()
  })
  it('cancels after successful CLI exit without replacing existing credentials', async () => {
    const h = harness({ before: validAuth, deferAdoption: true })
    await h.service.begin('work', true)
    await h.started
    h.exit.resolve(0)
    await h.service.settled()
    h.service.cancel('work')
    await h.service.settledAccount('work')
    expect(h.service.pendingHome('work')).toBeUndefined()
    expect(h.files.adopt).not.toHaveBeenCalled()
    expect(h.files.cleanup).toHaveBeenCalledWith(stage)
    expect(h.service.state('work').status).toBe('cancelled')
  })
  it('requires explicit replacement consent before starting a CLI when credentials already exist', async () => {
    const h = harness({ before: validAuth })
    await h.service.begin('work')
    await h.service.settled()
    expect(h.service.state('work').errorCode).toBe('replace-required')
    expect(h.run).not.toHaveBeenCalled()
    expect(h.files.stage).not.toHaveBeenCalled()
    await h.service.begin('work', true)
    await h.started
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.files.adopt).toHaveBeenCalledWith(stage, layout, validAuth.fingerprint)
  })
  it('cancels without replacing target auth, suppresses late output/completion and blocks an overlapping retry', async () => {
    const h = harness()
    await h.service.begin('work')
    await h.started
    h.emit(prompt)
    expect(h.service.cancel('work').status).toBe('cancelled')
    expect(h.aborted()).toBe(true)
    expect((await h.service.begin('work')).status).toBe('cancelled')
    h.emit(prompt)
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.service.state('work')).toMatchObject({ status: 'cancelled', userCode: null })
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(h.files.adopt).not.toHaveBeenCalled()
    expect(h.onComplete).not.toHaveBeenCalled()
    expect(h.files.cleanup).toHaveBeenCalledOnce()
  })
  it('times out, aborts the subprocess and never adopts its late success', async () => {
    vi.useFakeTimers()
    const h = harness({ timeoutMs: 100 })
    await h.service.begin('work')
    await h.started
    await vi.advanceTimersByTimeAsync(100)
    expect(h.service.state('work')).toMatchObject({ status: 'error', errorCode: 'timeout' })
    expect(h.aborted()).toBe(true)
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.files.adopt).not.toHaveBeenCalled()
  })
  it.each(['removed', 'renamed-home', 'changed-kind', 'disposed'])('cancels when account is %s', async change => {
    const h = harness()
    await h.service.begin('work')
    await h.started
    if (change === 'disposed') h.service.dispose()
    else
      h.service.reconcile(
        change === 'removed'
          ? []
          : [{ instanceId: 'work', kind: change === 'changed-kind' ? 'claude' : 'codex', layout: { ...layout, effectiveHomePath: '/home/test/another' } }],
      )
    expect(h.aborted()).toBe(true)
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.files.adopt).not.toHaveBeenCalled()
    expect(h.service.state('work').status).toBe('cancelled')
  })
  it('aborts the managed process through the actual Cordis runtime disposal hook', async () => {
    const h = harness()
    const root = new Context()
    const fiber = await root.plugin(ctx => {
      activateAccountRuntime(ctx).accountLogin = h.service
    })
    try {
      await h.service.begin('work')
      await h.started
      await fiber.dispose()
      expect(h.aborted()).toBe(true)
      h.exit.resolve(0)
      await h.service.settled()
      expect(h.service.state('work').status).toBe('cancelled')
      expect(h.files.adopt).not.toHaveBeenCalled()
      expect(h.files.cleanup).toHaveBeenCalledOnce()
    } finally {
      await fiber.dispose()
    }
  })
  it('checks account still exists again after process exit even without a route refresh', async () => {
    const h = harness()
    await h.service.begin('work')
    await h.started
    h.account(undefined)
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.service.state('work').status).toBe('cancelled')
    expect(h.files.adopt).not.toHaveBeenCalled()
  })
  it.each([1, null])('does not trust failed CLI exit %s', async code => {
    const h = harness()
    await h.service.begin('work')
    await h.started
    h.exit.resolve(code)
    await h.service.settled()
    expect(h.service.state('work').errorCode).toBe('failed')
    expect(h.files.adopt).not.toHaveBeenCalled()
  })
  it('requires real saved auth, not CLI exit zero', async () => {
    const h = harness({ stageAuth: emptyAuth })
    await h.service.begin('work')
    await h.started
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.service.state('work').errorCode).toBe('auth-not-saved')
    expect(h.files.adopt).not.toHaveBeenCalled()
    expect(h.onComplete).not.toHaveBeenCalled()
  })
  it('preserves credentials that changed concurrently', async () => {
    const h = harness()
    vi.mocked(h.files.adopt).mockReturnValue(false)
    await h.service.begin('work')
    await h.started
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.service.state('work').errorCode).toBe('auth-changed')
    expect(h.onComplete).not.toHaveBeenCalled()
  })
  it('reports a missing CLI as actionable unsupported, never installs or fakes success', async () => {
    const h = harness({
      run: async () => {
        throw new CodexLoginUnsupported()
      },
    })
    await h.service.begin('work')
    await h.service.settled()
    expect(h.service.state('work')).toMatchObject({ status: 'error', errorCode: 'unsupported' })
    expect(h.service.state('work').message).toContain('Install the official OpenAI Codex CLI')
    expect(h.files.adopt).not.toHaveBeenCalled()
  })
  it.each(['unknown', 'claude', 'github-copilot'])('rejects unsupported/missing account %s without spawning', async kind => {
    const h = harness({ kind })
    if (kind === 'unknown') h.account(undefined)
    expect((await h.service.begin('work')).errorCode).toBe(kind === 'unknown' ? 'unavailable' : 'unsupported')
    expect(h.run).not.toHaveBeenCalled()
    expect(h.files.prepare).not.toHaveBeenCalled()
  })
  it.each(['evil-url', 'oversize'])('bounds and redacts %s output', async bad => {
    const h = harness()
    await h.service.begin('work')
    await h.started
    h.emit(bad === 'evil-url' ? prompt.replace('auth.openai.com', 'attacker.test') : 'secret-never-reflected'.repeat(1000))
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.service.state('work').errorCode).toBe('invalid-output')
    expect(JSON.stringify(h.service.state('work'))).not.toMatch(/attacker|secret-never-reflected/u)
    expect(h.aborted()).toBe(true)
    expect(h.files.adopt).not.toHaveBeenCalled()
  })
  it('reports a cleanup failure without leaking private diagnostics', async () => {
    const h = harness()
    vi.mocked(h.files.cleanup).mockRejectedValue(new Error('private-path-and-token'))
    await h.service.begin('work')
    await h.started
    h.service.cancel('work')
    h.exit.resolve(0)
    await h.service.settled()
    expect(h.service.state('work').errorCode).toBe('cleanup-failed')
    expect(h.service.state('work').message).not.toContain('private-path-and-token')
    expect(h.files.adopt).not.toHaveBeenCalled()
  })
  it('sanitizes arbitrary subprocess errors and keeps verified auth if route refresh fails', async () => {
    const h = harness({
      run: async () => {
        throw new Error('raw-token-and-url-secret')
      },
    })
    await h.service.begin('work')
    await h.service.settled()
    expect(JSON.stringify(h.service.state('work'))).not.toContain('raw-token')
    const refresh = harness()
    refresh.onComplete.mockRejectedValue(new Error('private-path'))
    await refresh.service.begin('work')
    await refresh.started
    refresh.exit.resolve(0)
    await refresh.service.settled()
    expect(refresh.service.state('work')).toMatchObject({ status: 'error', errorCode: 'refresh-failed' })
    expect(refresh.files.adopt).toHaveBeenCalledOnce()
  })
})
