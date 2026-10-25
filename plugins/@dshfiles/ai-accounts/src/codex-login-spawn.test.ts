import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
import { CodexLoginUnsupported, createCodexLoginRunner, type CodexLoginSpawn } from './codex-login-process.js'

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
  it('records the Codex login span until cancellation closes the process without exposing instructions or paths', async () => {
    using recorder = recordSpans()
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const controller = new AbortController()
    const run = createCodexLoginRunner(
      undefined,
      {},
    )({
      home: '/private/synthetic-secret-home',
      signal: controller.signal,
      onOutput: () => {},
    })
    child.stdout.write('synthetic-device-code-not-for-traces')
    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(recorder.spans).toHaveLength(0)
    child.emit('close', null)
    await expect(run).resolves.toBeNull()
    const span = recorder.span('ai-accounts codex login')
    expect(span.kind).toBe('client')
    expect(span.attributes).toEqual({})
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('synthetic-secret-home')
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('synthetic-device-code')
  })
  it.each(['synchronous spawn', 'rejected completion'] as const)('sanitizes %s before tracing sees arbitrary error names and codes', async mode => {
    using recorder = recordSpans()
    const secret = 'synthetic-sensitive-code-and-name'
    const raw = Object.assign(new Error(secret), { name: secret, code: secret })
    const createChild: CodexLoginSpawn = () => {
      if (mode === 'synchronous spawn') throw raw
      return { finished: Promise.reject(raw), onOutput: () => {}, kill: () => {} }
    }
    await expect(
      createCodexLoginRunner(createChild, {})({ home: '/private/synthetic-stage', signal: new AbortController().signal, onOutput: () => {} }),
    ).rejects.toThrow('Official Codex CLI could not start or stop')
    const span = recorder.span('ai-accounts codex login')
    expect(span.attributes).toEqual({ 'error.type': 'Error' })
    expect(span.status.code).toBe('error')
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain(secret)
  })
  it('records rejected Codex login as an error without reflecting raw spawn diagnostics', async () => {
    using recorder = recordSpans()
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const run = createCodexLoginRunner(undefined, {})({ home: '/private/synthetic-stage', signal: new AbortController().signal, onOutput: () => {} })
    child.emit('error', Object.assign(new Error('synthetic-secret-diagnostic'), { code: 'ENOENT' }))
    child.emit('close', -2)
    await expect(run).rejects.toBeInstanceOf(CodexLoginUnsupported)
    const span = recorder.span('ai-accounts codex login')
    expect(span.status.code).toBe('error')
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('synthetic-secret-diagnostic')
  })
})
