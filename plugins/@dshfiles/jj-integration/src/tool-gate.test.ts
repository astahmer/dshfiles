import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceOwnershipView } from './ownership.js'
import { createToolGate, protectedHit, type GateExecution } from './tool-gate.js'

const view = (overrides: Partial<WorkspaceOwnershipView> = {}): WorkspaceOwnershipView => ({
  workspaceName: 'thread-a',
  isolated: true,
  unsafe: false,
  writerEpoch: 1,
  writerLease: { sessionId: 'session-owner', epoch: 1, heartbeatAt: 0 },
  observers: [],
  ...overrides,
})

const execution = (name: string, sessionId: string, cwd = '/threads/thread-a'): GateExecution => ({
  name,
  agent: { id: sessionId, session: { header: { cwd } } },
})

const build = (
  options: {
    readonly view?: WorkspaceOwnershipView | undefined
    readonly now?: number
    readonly acquireFails?: boolean
    readonly protectedPaths?: readonly string[]
  } = {},
) => {
  const next = vi.fn(() => Promise.resolve({ kind: 'allow' }))
  const acquireWriter = vi.fn(() =>
    options.acquireFails === true
      ? Promise.reject(new Error('workspace "thread-a" already has a live writer'))
      : Promise.resolve({ writerLease: { epoch: 7 } }),
  )
  const heartbeatWriter = vi.fn(() => Promise.resolve({}))
  const denials: string[] = []
  const gate = createToolGate({
    ownershipForPath: () => Promise.resolve(options.view === undefined ? undefined : { workspaceId: 'workspace-1', view: options.view }),
    acquireWriter,
    heartbeatWriter,
    staleAfterMs: 60_000,
    readOnlyTools: ['read', 'grep'],
    protectedPaths: options.protectedPaths ?? [],
    hostname: () => 'test-host',
    now: () => options.now ?? 0,
    cacheMs: 0,
    onDeny: input => denials.push(input.code),
  })
  return { gate, next, acquireWriter, heartbeatWriter, denials }
}

describe('tool-boundary ownership gate', () => {
  it('admits the owner and refreshes its lease', async () => {
    const { gate, next, heartbeatWriter } = build({ view: view() })
    await expect(gate(execution('write', 'session-owner'), next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()
    expect(heartbeatWriter).toHaveBeenCalledWith({ workspaceId: 'workspace-1', sessionId: 'session-owner' })
  })

  it('takes the lease for the first caller of a free workspace', async () => {
    const { gate, next, acquireWriter } = build({ view: view({ writerLease: null, writerEpoch: 0 }) })
    await expect(gate(execution('bash', 'session-new'), next)).resolves.toEqual({ kind: 'allow' })
    expect(acquireWriter).toHaveBeenCalledWith({ workspaceId: 'workspace-1', sessionId: 'session-new', host: 'test-host' })
    expect(next).toHaveBeenCalledOnce()
  })

  it('refuses a foreign writer before the tool body runs', async () => {
    const { gate, next, denials } = build({ view: view() })
    const decision = await gate(execution('bash', 'session-other'), next)
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(next).not.toHaveBeenCalled()
    expect(denials).toEqual(['writer-held'])
  })

  it('fences a writer whose lease was transferred away under it', async () => {
    let current = view({ writerLease: null, writerEpoch: 0 })
    const next = vi.fn(() => Promise.resolve({ kind: 'allow' }))
    const denials: string[] = []
    const gate = createToolGate({
      ownershipForPath: () => Promise.resolve({ workspaceId: 'workspace-1', view: current }),
      acquireWriter: () => Promise.resolve({ writerLease: { epoch: 4 } }),
      heartbeatWriter: () => Promise.resolve({}),
      staleAfterMs: 60_000,
      readOnlyTools: ['read'],
      hostname: () => 'test-host',
      now: () => 0,
      cacheMs: 0,
      onDeny: input => denials.push(input.code),
    })

    // session-a claims an unowned workspace and keeps writing there.
    await expect(gate(execution('write', 'session-a'), next)).resolves.toEqual({ kind: 'allow' })
    expect(denials).toEqual([])

    // A transfer hands the workspace to session-b with a new epoch and keeps
    // session-a as an observer: its writes are fenced, its reads still work.
    current = view({ writerEpoch: 5, writerLease: { sessionId: 'session-b', epoch: 5, heartbeatAt: 0 }, observers: ['session-a'] })
    await expect(gate(execution('write', 'session-a'), next)).resolves.toMatchObject({ kind: 'deny' })
    expect(denials).toEqual(['writer-fenced'])
    await expect(gate(execution('read', 'session-a'), next)).resolves.toEqual({ kind: 'allow' })
    await expect(gate(execution('write', 'session-b'), next)).resolves.toEqual({ kind: 'allow' })
  })

  it('fails closed when the ownership check cannot complete', async () => {
    const next = vi.fn(() => Promise.resolve({ kind: 'allow' }))
    const gate = createToolGate({
      ownershipForPath: () => Promise.reject(new Error('state-unreadable')),
      acquireWriter: () => Promise.resolve({ writerLease: null }),
      heartbeatWriter: () => Promise.resolve({}),
      staleAfterMs: 60_000,
      readOnlyTools: [],
      hostname: () => 'test-host',
      cacheMs: 0,
    })
    const decision = await gate(execution('bash', 'session-a'), next)
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(decision).toHaveProperty('reason', expect.stringContaining('state-unreadable'))
    expect(next).not.toHaveBeenCalled()
  })

  it('denies when the lease is taken by another session between the check and the claim', async () => {
    const { gate, next, acquireWriter } = build({ view: view({ writerLease: null }), acquireFails: true })
    const decision = await gate(execution('bash', 'session-a'), next)
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(acquireWriter).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
  })

  it('passes through when the directory is not a registered workspace or the call has no agent', async () => {
    const { gate, next } = build({ view: undefined })
    await expect(gate(execution('bash', 'session-a'), next)).resolves.toEqual({ kind: 'allow' })
    await expect(gate({ name: 'bash' }, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })
})

/**
 * The residual hole is a shell string: deciding what `bash` writes is not a
 * tool-level cwd guard's job. A structured write tool does name its target, so
 * that case is refused rather than merely documented.
 */
describe('structured writes into another workspace', () => {
  const buildForeign = () => {
    const next = vi.fn(() => Promise.resolve({ kind: 'allow' }))
    const denials: string[] = []
    const gate = createToolGate({
      ownershipForPath: path =>
        path.startsWith('/threads/thread-b')
          ? Promise.resolve({ workspaceId: 'workspace-2', view: view({ workspaceName: 'thread-b' }) })
          : path.startsWith('/shared')
            ? Promise.resolve({ workspaceId: 'workspace-3', view: view({ workspaceName: 'shared', isolated: false }) })
            : Promise.resolve({ workspaceId: 'workspace-1', view: view() }),
      acquireWriter: () => Promise.resolve({ writerLease: { epoch: 7 } }),
      heartbeatWriter: () => Promise.resolve({}),
      staleAfterMs: 60_000,
      readOnlyTools: ['read'],
      hostname: () => 'test-host',
      now: () => 0,
      cacheMs: 0,
      onDeny: input => denials.push(input.code),
    })
    return { gate, next, denials }
  }

  const call = (name: string, args: unknown) => ({ name, arguments: args, agent: { id: 'session-owner', session: { header: { cwd: '/threads/thread-a' } } } })

  it('refuses a write whose absolute target is inside another isolated workspace', async () => {
    const { gate, next, denials } = buildForeign()
    const decision = await gate(call('write', { path: '/threads/thread-b/src/a.ts', content: 'x' }), next)
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(decision).toHaveProperty('reason', expect.stringContaining('thread-b'))
    expect(next).not.toHaveBeenCalled()
    expect(denials).toEqual(['foreign-workspace'])
  })

  it('admits a write inside the caller own workspace and one outside every workspace', async () => {
    const { gate, next } = buildForeign()
    await expect(gate(call('edit', { path: '/threads/thread-a/src/a.ts' }), next)).resolves.toEqual({ kind: 'allow' })
    await expect(gate(call('write', { path: '/tmp/scratch.txt' }), next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('does not fence a shared checkout that was only discovered', async () => {
    const { gate, next } = buildForeign()
    await expect(gate(call('write', { path: '/shared/notes.md' }), next)).resolves.toEqual({ kind: 'allow' })
  })

  it('leaves a shell command untouched, because its writes are not a structured path', async () => {
    const { gate, next } = buildForeign()
    await expect(gate(call('bash', { command: 'echo x > /threads/thread-b/a.ts' }), next)).resolves.toEqual({ kind: 'allow' })
  })
})

/**
 * The recovery store is the one thing that has to survive an agent breaking
 * everything else, so it is refused in every Session — including one whose cwd
 * is not a registered workspace at all.
 */
describe('protected recovery store', () => {
  const store = '/Users/someone/.dsh-lkg'
  const call = (name: string, args: unknown, cwd = '/threads/thread-a') => ({
    name,
    arguments: args,
    agent: { id: 'session-owner', session: { header: { cwd } } },
  })

  it('matches the absolute path, the tilde form and the launcher name, at any depth', () => {
    expect(protectedHit({ command: `rm -rf ${store}/versions` }, [store])).toBe(store)
    expect(protectedHit({ command: 'rm -rf ~/.dsh-lkg/versions' }, [store])).toBe(store)
    expect(protectedHit({ nested: { list: ['ok', `${store}/current`] } }, [store])).toBe(store)
    expect(protectedHit({ command: 'dsh-recover --port 3099' }, [store])).toBe(store)
    expect(protectedHit({ command: 'dsh-lkg snapshot' }, [store])).toBe(store)
    expect(protectedHit({ command: 'rm -rf /tmp/other' }, [store])).toBeUndefined()
    expect(protectedHit({ command: `rm -rf ${store}` }, [])).toBeUndefined()
    expect(protectedHit({ command: 'dsh-recover' }, [])).toBeUndefined()
  })

  it('refuses a shell command that names the store, before the tool body runs', async () => {
    const { gate, next, denials } = build({ view: view(), protectedPaths: [store] })
    const decision = await gate(call('bash', { command: `rm -rf ${store}/versions` }), next)
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(decision).toHaveProperty('reason', expect.stringContaining('last known good'))
    expect(next).not.toHaveBeenCalled()
    expect(denials).toEqual(['protected-path'])
  })

  it('refuses it even when the Session is not in a registered workspace', async () => {
    const { gate, next } = build({ view: undefined, protectedPaths: [store] })
    await expect(gate(call('bash', { command: `dsh-recover --port 3099` }, '/not/a/workspace'), next)).resolves.toMatchObject({ kind: 'deny' })
    expect(next).not.toHaveBeenCalled()
  })

  it('leaves everything else alone', async () => {
    const { gate, next } = build({ view: view(), protectedPaths: [store] })
    await expect(gate(call('bash', { command: 'ls /tmp' }), next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()
  })
})
