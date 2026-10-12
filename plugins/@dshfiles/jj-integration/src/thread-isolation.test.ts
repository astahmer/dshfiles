import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JjExecutor } from './jj.js'
import type { ExistingBinding } from './thread-provision.js'
import { createThreadWorkspaceResolver, threadWorkspacesDirectory } from './thread-isolation.js'

const realJj: JjExecutor = async ({ args, cwd }) => {
  try {
    const stdout = execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return { exitCode: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { exitCode: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const mkRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'thread-isolation-'))
  const repo = join(root, 'dshfiles')
  execFileSync('jj', ['git', 'init', '--no-colocate', repo], { cwd: root, encoding: 'utf8' })
  execFileSync('jj', ['describe', '-m', 'spine'], { cwd: repo, encoding: 'utf8' })
  execFileSync('jj', ['bookmark', 'set', 'integration-spine', '-r', '@'], { cwd: repo, encoding: 'utf8' })
  execFileSync('jj', ['new', '-m', 'default slot'], { cwd: repo, encoding: 'utf8' })
  return { root, repo }
}

const recorder = () => {
  const bindings = new Map<string, ExistingBinding>()
  const remembered: { sessionId: string; path: string; baseCommitId: string | null }[] = []
  return {
    bindings,
    remembered,
    findBinding: async (sessionId: string) => bindings.get(sessionId),
    rememberBinding: async (input: { sessionId: string; workspaceName: string; path: string; baseCommitId: string | null }) => {
      bindings.set(input.sessionId, { workspaceName: input.workspaceName, path: input.path })
      remembered.push({ sessionId: input.sessionId, path: input.path, baseCommitId: input.baseCommitId })
    },
  }
}

describe('thread workspace resolution', () => {
  it('provisions an independent workspace in auto mode and remembers the binding', async () => {
    const { root, repo } = mkRepo()
    const store = recorder()
    const resolver = createThreadWorkspaceResolver({
      mode: () => 'auto',
      executor: realJj,
      spineRevision: 'integration-spine',
      findBinding: store.findBinding,
      rememberBinding: store.rememberBinding,
    })

    const first = await resolver.resolve({ sessionId: 'session-a', requestedCwd: repo })
    expect(first.kind).toBe('resolved')
    const workspacePath = first.kind === 'resolved' ? first.cwd : ''
    expect(workspacePath.startsWith(threadWorkspacesDirectory(repo))).toBe(true)
    expect(store.remembered).toHaveLength(1)

    // A second session gets a different workspace; the same session is idempotent.
    const second = await resolver.resolve({ sessionId: 'session-b', requestedCwd: repo })
    expect(second.kind === 'resolved' && second.cwd !== workspacePath).toBe(true)
    const again = await resolver.resolve({ sessionId: 'session-a', requestedCwd: repo })
    expect(again).toEqual({ kind: 'resolved', cwd: workspacePath })

    const names = execFileSync('jj', ['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"'], { cwd: repo, encoding: 'utf8' })
    expect(names.split('\n').filter(line => line.startsWith('dshfiles-')).length).toBe(2)
    rmSync(root, { recursive: true, force: true })
  })

  it('passes non-jj directories through in auto mode instead of refusing them', async () => {
    const { root, repo } = mkRepo()
    const plain = join(root, 'plain')
    mkdirSync(plain)
    const store = recorder()
    const resolver = createThreadWorkspaceResolver({
      mode: () => 'auto',
      executor: realJj,
      spineRevision: 'integration-spine',
      findBinding: store.findBinding,
      rememberBinding: store.rememberBinding,
    })
    expect(await resolver.resolve({ sessionId: 'session-plain', requestedCwd: plain })).toEqual({ kind: 'passthrough' })
    expect(await resolver.resolve({ sessionId: 'session-plain', requestedCwd: repo })).toMatchObject({ kind: 'resolved' })
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses instead of falling back to the shared checkout when provisioning fails', async () => {
    const { root, repo } = mkRepo()
    const store = recorder()
    const resolver = createThreadWorkspaceResolver({
      mode: () => 'auto',
      executor: realJj,
      spineRevision: 'no-such-bookmark',
      findBinding: store.findBinding,
      rememberBinding: store.rememberBinding,
    })
    const outcome = await resolver.resolve({ sessionId: 'session-broken', requestedCwd: repo })
    expect(outcome.kind).toBe('refused')
    expect(store.remembered).toHaveLength(0)
    rmSync(root, { recursive: true, force: true })
  })

  it('never provisions in off mode and provisions nothing in manual mode without a binding', async () => {
    const { root, repo } = mkRepo()
    const store = recorder()
    let jjCalls = 0
    const countingJj: JjExecutor = async input => {
      jjCalls += 1
      return realJj(input)
    }
    const off = createThreadWorkspaceResolver({
      mode: () => 'off',
      executor: countingJj,
      spineRevision: 'integration-spine',
      findBinding: store.findBinding,
      rememberBinding: store.rememberBinding,
    })
    expect(await off.resolve({ sessionId: 'session-off', requestedCwd: repo })).toEqual({ kind: 'passthrough' })
    expect(jjCalls).toBe(0)
    expect(store.bindings.size).toBe(0)

    const manual = createThreadWorkspaceResolver({
      mode: () => 'manual',
      executor: countingJj,
      spineRevision: 'integration-spine',
      findBinding: store.findBinding,
      rememberBinding: store.rememberBinding,
    })
    expect(await manual.resolve({ sessionId: 'session-manual', requestedCwd: repo })).toEqual({ kind: 'passthrough' })

    // A session already bound to a workspace still resolves there: turning the
    // mode down must not move an existing thread back to the shared checkout.
    store.bindings.set('session-bound', { workspaceName: 'dshfiles-bound', path: '/tmp/dshfiles-bound' })
    expect(await manual.resolve({ sessionId: 'session-bound', requestedCwd: repo })).toEqual({ kind: 'resolved', cwd: '/tmp/dshfiles-bound' })
    rmSync(root, { recursive: true, force: true })
  })
})
