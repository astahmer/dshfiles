import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { ClaudeAccountModel } from './claude-account.js'
import { verifyClaudeAuthStatus, type ClaudeAuthStatusRunner } from './claude-auth-status.js'

const processFake = vi.hoisted(() => ({ execFile: vi.fn((_file, _args, _options, callback) => callback(null, '{"loggedIn":true,"authMethod":"claude.ai"}')) }))
vi.mock('node:child_process', () => processFake)
vi.mock('node:os', () => ({ homedir: () => '/synthetic', tmpdir: () => '/synthetic/tmp' }))
vi.mock('node:fs', () => ({ mkdtempSync: vi.fn(() => '/synthetic/tmp/dsh-claude-status-fake'), rmSync: vi.fn() }))
const base = () => ({ configDir: '/synthetic/.claude', signal: new AbortController().signal, environment: { PATH: '/synthetic/bin', HOME: '/synthetic' } })
type StatusFixture = { readonly loggedIn?: boolean | string | number; readonly authMethod?: string }
const status = (body: StatusFixture, exitCode = 0): ClaudeAuthStatusRunner => vi.fn(async () => ({ exitCode, stdout: JSON.stringify(body) }))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('official Claude CLI authenticated configuration (not remote validation)', () => {
  it('records a claude auth status span until the subprocess callback without configuration or output', async () => {
    using recorder = recordSpans()
    let finish: (() => void) | undefined
    processFake.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
      finish = () => callback(null, '{"loggedIn":true,"authMethod":"private-auth-method"}')
    })
    const pending = verifyClaudeAuthStatus({ ...base(), environment: { CLAUDE_CODE_OAUTH_TOKEN: 'private-token' } })
    expect(recorder.named('claude auth status')).toHaveLength(0)
    expect(finish).toBeDefined()
    finish?.()
    await pending
    const span = recorder.span('claude auth status')
    expect(span.kind).toBe('client')
    expect(span.attributes).toEqual({ 'process.executable.name': 'claude', 'process.exit.code': 0 })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toMatch(/private|synthetic|loggedIn/)
  })

  it('redacts subprocess failure details from the claude auth status span', async () => {
    using recorder = recordSpans()
    processFake.execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('private-token-and-output'), 'private-stdout'))
    await expect(verifyClaudeAuthStatus(base())).rejects.toThrow('did not confirm')
    const span = recorder.span('claude auth status')
    expect(span.status).toEqual({ code: 'error', message: 'Error' })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('private')
  })
  it('runs only the official bounded status command without a shell or credential argument', async () => {
    await verifyClaudeAuthStatus(base())
    expect(processFake.execFile).toHaveBeenCalledWith(
      'claude',
      ['--setting-sources', '', 'auth', 'status', '--json'],
      expect.objectContaining({
        cwd: '/synthetic/tmp/dsh-claude-status-fake',
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        killSignal: 'SIGKILL',
        signal: expect.any(AbortSignal),
        env: base().environment,
      }),
      expect.any(Function),
    )
    expect(processFake.execFile.mock.calls[0]?.[2]).not.toHaveProperty('shell')
  })

  it('preserves the native CLI environment, including its OAuth token and configured directory', async () => {
    const run = status({ loggedIn: true })
    await verifyClaudeAuthStatus({
      ...base(),
      run,
      configDir: "/synthetic/work's $(echo no)",
      environment: {
        ...base().environment,
        CLAUDE_CONFIG_DIR: '/synthetic/inherited',
        CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-token',
        ANTHROPIC_API_KEY: 'unrelated-key',
        ANTHROPIC_AUTH_TOKEN: 'unrelated-bearer',
        CLAUDE_CODE_USE_BEDROCK: '1',
      },
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: {
          ...base().environment,
          CLAUDE_CONFIG_DIR: "/synthetic/work's $(echo no)",
          CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-token',
          CLAUDE_CODE_USE_BEDROCK: '1',
        },
      }),
    )
  })

  it('reaches the default login with CLAUDE_CONFIG_DIR unset instead of inheriting another realm', async () => {
    const run = status({ loggedIn: true })
    await verifyClaudeAuthStatus({
      ...base(),
      run,
      environment: { CLAUDE_CONFIG_DIR: '/synthetic/inherited', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/synthetic/inherited' },
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ environment: {} }))
  })

  it('pins a custom config directory', async () => {
    const run = status({ loggedIn: true })
    await verifyClaudeAuthStatus({ ...base(), configDir: '/synthetic/.claude-work', run, environment: { CLAUDE_CONFIG_DIR: '/synthetic/inherited' } })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ environment: { CLAUDE_CONFIG_DIR: '/synthetic/.claude-work' } }))
  })

  it.each([{}, { loggedIn: false }, { loggedIn: 'true' }, { loggedIn: 1 }])('rejects unsupported status %j', async body => {
    await expect(verifyClaudeAuthStatus({ ...base(), run: status(body) })).rejects.toThrow('did not confirm')
  })

  it('requires exit success even when JSON claims loggedIn', async () => {
    await expect(verifyClaudeAuthStatus({ ...base(), run: status({ loggedIn: true }, 1) })).rejects.toThrow('did not confirm')
  })

  it.each(['invalid-json synthetic-secret', '{"loggedIn":true}\nsynthetic-secret'])('redacts malformed stdout', async stdout => {
    await expect(verifyClaudeAuthStatus({ ...base(), run: async () => ({ stdout, exitCode: 0 }) })).rejects.toThrow(
      'The official Claude CLI did not confirm an authenticated configuration.',
    )
  })

  it('redacts missing executable and raw subprocess errors', async () => {
    const error = await verifyClaudeAuthStatus({
      ...base(),
      run: async () => {
        throw new Error('ENOENT synthetic-secret stdout stderr')
      },
    }).catch((cause: unknown) => cause)
    expect(error).toEqual(new Error('The official Claude CLI did not confirm an authenticated configuration.'))
    expect(error).not.toHaveProperty('cause')
  })

  it('does not launch when cancelled', async () => {
    const controller = new AbortController()
    controller.abort('synthetic-secret')
    const run = status({ loggedIn: true })
    await expect(verifyClaudeAuthStatus({ ...base(), signal: controller.signal, run })).rejects.toThrow('did not confirm')
    expect(run).not.toHaveBeenCalled()
  })

  it('aborts a running status process and rejects its late success', async () => {
    const controller = new AbortController()
    let childSignal: AbortSignal | undefined
    const run: ClaudeAuthStatusRunner = async input => {
      childSignal = input.signal
      controller.abort()
      return { exitCode: 0, stdout: '{"loggedIn":true}' }
    }
    await expect(verifyClaudeAuthStatus({ ...base(), signal: controller.signal, run })).rejects.toThrow('did not confirm')
    expect(childSignal?.aborted).toBe(true)
  })

  it('bounds a runner ignoring cancellation and clears all timers', async () => {
    vi.useFakeTimers()
    let childSignal: AbortSignal | undefined
    const run: ClaudeAuthStatusRunner = async input => {
      childSignal = input.signal
      return new Promise(() => {})
    }
    const pending = expect(verifyClaudeAuthStatus({ ...base(), run })).rejects.toThrow('did not confirm')
    await vi.advanceTimersByTimeAsync(5_000)
    await pending
    expect(childSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('signs in to the default login without CLAUDE_CONFIG_DIR, which would create a separate keychain item', () => {
    expect(ClaudeAccountModel.claudeLoginHint('/synthetic/.claude')).toBe('claude auth login')
    expect(ClaudeAccountModel.claudeLoginHint('/synthetic/.claude-work')).toBe("CLAUDE_CONFIG_DIR='/synthetic/.claude-work' claude auth login")
  })

  it('single-quotes custom configuration paths in the login hint', () => {
    expect(ClaudeAccountModel.claudeLoginHint('/synthetic/work\'s $(echo no) `no` " $HOME')).toBe(
      "CLAUDE_CONFIG_DIR='/synthetic/work'\\''s $(echo no) `no` \" $HOME' claude auth login",
    )
  })
})
