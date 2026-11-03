import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { ClaudeAccountModel } from './claude-account.js'
import { createClaudeAuthStatusRunner, verifyClaudeAuthStatus, type ClaudeAuthStatusExec, type ClaudeAuthStatusRunner } from './claude-auth-status.js'

/** The official CLI, a neutral directory and its cleanup are the only things outside this module. */
const claudeCli = (
  answer: (callback: (error: Error | null, stdout: string) => void) => void = callback => callback(null, '{"loggedIn":true,"authMethod":"claude.ai"}'),
) => {
  const exec = vi.fn<ClaudeAuthStatusExec>((_input, callback) => answer(callback))
  const removeDirectory = vi.fn()
  return {
    exec,
    removeDirectory,
    run: createClaudeAuthStatusRunner({ exec, makeNeutralDirectory: () => '/synthetic/tmp/dsh-claude-status-fake', removeDirectory }),
  }
}
/** The CLI's own default login directory: the module compares against the real home, not a mock. */
const DEFAULT_CLAUDE_CONFIG_DIR = join(homedir(), '.claude')
const base = () => ({ configDir: '/synthetic/.claude', signal: new AbortController().signal, environment: { PATH: '/synthetic/bin', HOME: '/synthetic' } })
type StatusFixture = { readonly loggedIn?: boolean | string | number; readonly authMethod?: string }
const status = (body: StatusFixture, exitCode = 0): ClaudeAuthStatusRunner => vi.fn(async () => ({ exitCode, stdout: JSON.stringify(body) }))

describe('official Claude CLI authenticated configuration (not remote validation)', () => {
  it('records a claude auth status span until the subprocess callback without configuration or output', async () => {
    using recorder = recordSpans()
    let finish: (() => void) | undefined
    const cli = claudeCli(callback => {
      finish = () => callback(null, '{"loggedIn":true,"authMethod":"private-auth-method"}')
    })
    const pending = verifyClaudeAuthStatus({ ...base(), run: cli.run, environment: { CLAUDE_CODE_OAUTH_TOKEN: 'private-token' } })
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
    const cli = claudeCli(callback => callback(new Error('private-token-and-output'), 'private-stdout'))
    await expect(verifyClaudeAuthStatus({ ...base(), run: cli.run })).rejects.toThrow('did not confirm')
    const span = recorder.span('claude auth status')
    expect(span.status).toEqual({ code: 'error', message: 'Error' })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('private')
  })
  it('runs only the official bounded status command, in a neutral directory it removes afterwards', async () => {
    const cli = claudeCli()
    await verifyClaudeAuthStatus({ ...base(), run: cli.run })
    expect(cli.exec).toHaveBeenCalledWith(
      {
        args: ['--setting-sources', '', 'auth', 'status', '--json'],
        cwd: '/synthetic/tmp/dsh-claude-status-fake',
        environment: { ...base().environment, CLAUDE_CONFIG_DIR: '/synthetic/.claude' },
        signal: expect.any(AbortSignal),
      },
      expect.any(Function),
    )
    expect(cli.removeDirectory).toHaveBeenCalledWith('/synthetic/tmp/dsh-claude-status-fake')
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
      configDir: DEFAULT_CLAUDE_CONFIG_DIR,
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
    try {
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
    } finally {
      vi.useRealTimers()
    }
  })

  it('signs in to the default login without CLAUDE_CONFIG_DIR, which would create a separate keychain item', () => {
    expect(ClaudeAccountModel.claudeLoginHint(DEFAULT_CLAUDE_CONFIG_DIR)).toBe('claude auth login')
    expect(ClaudeAccountModel.claudeLoginHint('/synthetic/.claude-work')).toBe("CLAUDE_CONFIG_DIR='/synthetic/.claude-work' claude auth login")
  })

  it('single-quotes custom configuration paths in the login hint', () => {
    expect(ClaudeAccountModel.claudeLoginHint('/synthetic/work\'s $(echo no) `no` " $HOME')).toBe(
      "CLAUDE_CONFIG_DIR='/synthetic/work'\\''s $(echo no) `no` \" $HOME' claude auth login",
    )
  })
})
