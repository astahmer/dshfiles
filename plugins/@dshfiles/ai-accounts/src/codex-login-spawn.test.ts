import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
import { CodexLoginUnsupported, createCodexLoginRunner } from './codex-login-process.js'

const fakeChild = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), pid: undefined })

describe('official CLI Node spawn adapter (no real login)', () => {
  it('starts only fixed argv without a shell, closes stdin and pipes output without logging it', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const receive = vi.fn()
    const run = createCodexLoginRunner(undefined, { PATH: '/trusted/bin' })({
      home: '/private/fake-stage',
      signal: new AbortController().signal,
      onOutput: receive,
    })
    expect(spawn).toHaveBeenLastCalledWith(
      'codex',
      ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth'],
      expect.objectContaining({
        cwd: '/private/fake-stage',
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: expect.objectContaining({ CODEX_HOME: '/private/fake-stage' }),
      }),
    )
    child.stdout.write('fake-output-not-logged')
    child.stderr.write('fake-error-not-logged')
    expect(receive).toHaveBeenCalledWith('fake-output-not-logged')
    expect(receive).toHaveBeenCalledWith('fake-error-not-logged')
    child.emit('close', 0)
    expect(await run).toBe(0)
  })
  it('classifies missing CLI explicitly while suppressing raw spawn diagnostics', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const run = createCodexLoginRunner(undefined, {})({ home: '/private/fake-stage', signal: new AbortController().signal, onOutput: () => {} })
    const settled = vi.fn()
    void run.then(settled, settled)
    child.emit('error', Object.assign(new Error('raw-credential-never-reflect'), { code: 'ENOENT' }))
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    child.emit('close', -2)
    await expect(run).rejects.toBeInstanceOf(CodexLoginUnsupported)
    await expect(run).rejects.not.toThrow('raw-credential')
  })
})
