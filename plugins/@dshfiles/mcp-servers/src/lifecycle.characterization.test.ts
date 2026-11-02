import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { ManagedLocalCommand } from './local-process.js'
import { ClientReconciler, type ClientTarget } from './reconcile.js'

// MCP client lifecycle pinned before the manager moves to a Semaphore-guarded McpManager with per-server Scopes.
// Extends core.test.ts (including its Phase 0 plan-ordering race test) without repeating it.

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const target = (id: string, fingerprint: string, extra: Partial<ClientTarget> = {}): ClientTarget => ({
  id,
  enabled: true,
  ready: true,
  fingerprint,
  ...extra,
})

const gate = () => {
  let open: () => void = () => undefined
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  return { opened, open }
}

const recordingReconciler = (input: { readonly stopGate?: Promise<void>; readonly failing?: ReadonlySet<string> } = {}) => {
  const events: string[] = []
  const reconciler = new ClientReconciler(async next => {
    events.push(`start ${next.id}:${next.fingerprint}`)
    if (input.failing?.has(next.fingerprint) === true) throw new Error('start failed')
    return async () => {
      events.push(`stop-begin ${next.id}:${next.fingerprint}`)
      await input.stopGate
      events.push(`stop-end ${next.id}:${next.fingerprint}`)
    }
  })
  cleanups.push(() => reconciler.dispose())
  return { reconciler, events }
}

describe('client reconciler ordering', () => {
  it('applies update, reconcile and restart calls strictly in call order, whatever their own latency', async () => {
    const { reconciler, events } = recordingReconciler()
    const slowPlan = gate()
    const calls = [
      reconciler.update([target('one', 'a')]),
      reconciler.reconcile(async () => {
        await slowPlan.opened
        return { targets: [target('one', 'b')], restart: new Set<string>() }
      }),
      reconciler.update([target('one', 'c')]),
      reconciler.restart('one', [target('one', 'c')]),
    ]
    await Promise.resolve()
    slowPlan.open()
    await Promise.all(calls)
    expect(events).toEqual([
      'start one:a',
      'stop-begin one:a',
      'stop-end one:a',
      'start one:b',
      'stop-begin one:b',
      'stop-end one:b',
      'start one:c',
      'stop-begin one:c',
      'stop-end one:c',
      'start one:c',
    ])
    expect(reconciler.state('one')).toBe('loaded')
  })

  it('a replacement starts only after the previous client finished stopping', async () => {
    const stop = gate()
    const { reconciler, events } = recordingReconciler({ stopGate: stop.opened })
    await reconciler.update([target('one', 'a')])
    const replacing = reconciler.update([target('one', 'b')])
    await expect.poll(() => events).toEqual(['start one:a', 'stop-begin one:a'])
    stop.open()
    await replacing
    expect(events).toEqual(['start one:a', 'stop-begin one:a', 'stop-end one:a', 'start one:b'])
  })

  it('a plan that throws rejects its own call and leaves the queue running', async () => {
    const { reconciler, events } = recordingReconciler()
    const failing = reconciler.reconcile(async () => {
      throw new Error('credential resolution failed')
    })
    const next = reconciler.update([target('one', 'a')])
    await expect(failing).rejects.toThrow('credential resolution failed')
    await next
    expect(events).toEqual(['start one:a'])
  })

  it('a failed start is retried by every later update until it succeeds', async () => {
    const { reconciler, events } = recordingReconciler({ failing: new Set(['bad']) })
    await reconciler.update([target('one', 'bad')])
    expect(reconciler.state('one')).toBe('start-failed')
    await reconciler.update([target('one', 'bad')])
    expect(reconciler.state('one')).toBe('start-failed')
    await reconciler.update([target('one', 'good')])
    expect(reconciler.state('one')).toBe('loaded')
    expect(events).toEqual(['start one:bad', 'start one:bad', 'start one:good'])
  })

  it('servers start and stop independently, and dispose stops every active client', async () => {
    const { reconciler, events } = recordingReconciler()
    await reconciler.update([target('one', 'a'), target('two', 'a'), target('three', 'a', { ready: false })])
    expect(['one', 'two', 'three'].map(id => reconciler.state(id))).toEqual(['loaded', 'loaded', 'inactive'])
    await reconciler.update([target('one', 'a'), target('three', 'a', { ready: false })])
    expect(reconciler.state('two')).toBe('inactive')
    await reconciler.dispose()
    expect(events).toEqual(['start one:a', 'start two:a', 'stop-begin two:a', 'stop-end two:a', 'stop-begin one:a', 'stop-end one:a'])
    expect(reconciler.state('one')).toBe('inactive')
  })

  it('restarting a server the targets no longer want just stops it', async () => {
    const { reconciler, events } = recordingReconciler()
    await reconciler.update([target('one', 'a')])
    await reconciler.restart('one', [target('one', 'a', { enabled: false })])
    expect(events).toEqual(['start one:a', 'stop-begin one:a', 'stop-end one:a'])
    expect(reconciler.state('one')).toBe('inactive')
  })
})

const subprocessRuntime = async (): Promise<SubprocessRuntime> => {
  const host = await createTestHost()
  cleanups.push(() => host.dispose())
  await host.ctx.plugin(LocalSubprocessRuntime)
  const runtime = host.ctx.get('subprocess')
  if (runtime === undefined) throw new Error('The local subprocess runtime did not register.')
  return runtime
}

const scratch = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-servers-local-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

const readPid = async (path: string): Promise<number> => {
  try {
    return Number((await readFile(path, 'utf8')).trim())
  } catch {
    return 0
  }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('managed local start command on the real subprocess runtime', () => {
  it('starts, runs, and stops its whole process group', async () => {
    const runtime = await subprocessRuntime()
    const directory = await scratch()
    const pidFile = join(directory, 'child.pid')
    const managed = await ManagedLocalCommand.start(runtime, { command: 'sh', args: ['-c', `sleep 30 & echo $! > '${pidFile}'; wait`], cwd: directory }, {})
    expect(managed.status).toBe('starting')
    managed.markRunning()
    expect(managed.status).toBe('running')
    await expect.poll(() => readPid(pidFile)).toBeGreaterThan(0)
    const pid = await readPid(pidFile)
    expect(isAlive(pid)).toBe(true)

    const first = managed.stop()
    const second = managed.stop()
    expect(managed.status).toBe('stopping')
    await Promise.all([first, second])
    expect(managed.status).toBe('stopped')
    expect(isAlive(pid)).toBe(false)
    await managed.stop()
    expect(managed.status).toBe('stopped')
  }, 20_000)

  it('runs in the requested directory with the resolved environment references', async () => {
    const runtime = await subprocessRuntime()
    const directory = await scratch()
    const managed = await ManagedLocalCommand.start(
      runtime,
      { command: 'sh', args: ['-c', 'pwd > where.txt; printf %s "$MCP_TOKEN" > token.txt'], cwd: directory },
      { MCP_TOKEN: 'resolved-token' },
    )
    await expect.poll(() => managed.status).toBe('exited')
    expect((await readFile(join(directory, 'where.txt'), 'utf8')).trim()).toMatch(/mcp-servers-local-/)
    expect(await readFile(join(directory, 'token.txt'), 'utf8')).toBe('resolved-token')
  })

  it('an early exit is reported as exited, survives markRunning, and stop then confirms stopped', async () => {
    const runtime = await subprocessRuntime()
    const directory = await scratch()
    const managed = await ManagedLocalCommand.start(runtime, { command: 'sh', args: ['-c', 'exit 3'], cwd: directory }, {})
    await expect.poll(() => managed.status).toBe('exited')
    managed.markRunning()
    expect(managed.status).toBe('exited')
    await managed.stop()
    expect(managed.status).toBe('stopped')
  })

  it('an executable that does not resolve rejects the start', async () => {
    const runtime = await subprocessRuntime()
    const directory = await scratch()
    await expect(ManagedLocalCommand.start(runtime, { command: 'definitely-not-an-mcp-command', args: [], cwd: directory }, {})).rejects.toThrow()
  })
})
