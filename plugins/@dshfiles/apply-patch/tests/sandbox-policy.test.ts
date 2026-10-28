import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService, { setSandboxMode, type Config as PolicyConfig } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, describe, expect, it } from 'vitest'
import plugin from '../src/host.js'

type Mode = NonNullable<PolicyConfig['mode']>
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(defaultMode: Mode = 'workspace-write', sandboxed = true, withPolicy = true) {
  // Temp roots are writable in workspace-write mode, so put the private fixture
  // under the home directory to genuinely test containment and symlink escapes.
  const root = await mkdtemp(join(homedir(), '.dsh-apply-patch-test-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const deployment = join(root, 'deployment')
  const workspace = join(root, 'session-workspace')
  const outside = join(root, 'outside')
  await Promise.all([deployment, workspace, outside].map(path => mkdir(path)))
  const host = await createTestHost()
  cleanups.push(() => host.dispose())
  await host.ctx.plugin(SessionStore)
  await host.ctx.plugin(SessionProjectionRegistry)
  if (withPolicy) await host.ctx.plugin(SandboxPolicyService, { mode: defaultMode, workspaceRoot: deployment })
  if (sandboxed) await host.ctx.plugin(SandboxedFileSystem, { cwd: deployment })
  else await host.ctx.plugin(LocalFileSystem, { cwd: deployment })
  await host.ctx.plugin(WorkingDirectoryService)
  await host.ctx.plugin(LlmRuntime)
  await host.ctx.plugin(AgentRegistry)
  await host.ctx.plugin(AgentLoop)
  if (process.env.DSH_APPLY_PATCH_BUILT === '1') {
    const bundle = new URL('../dist/index.js', import.meta.url).href
    await host.mount(await import(bundle), { packageId: '@dshfiles/apply-patch', native: true })
  } else {
    await host.mount(plugin, { packageId: '@dshfiles/apply-patch' })
  }
  const createAgent = async (cwd: string, mode?: Mode) => {
    const handle = await host.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd } })
    cleanups.push(() => handle.dispose())
    if (mode !== undefined) setSandboxMode(handle.agent.session, mode)
    return handle.agent
  }
  const agent = await createAgent(workspace)
  const patch = (path: string, caller: Agent | null = agent, old = 'before', replacement = 'after') => {
    const request = {
      callId: ToolCallId(randomUUID()),
      name: 'apply_patch',
      arguments: { path, edits: [{ old, new: replacement }] },
      signal: new AbortController().signal,
    }
    return host.tools.execute(caller === null ? request : { ...request, agent: caller })
  }
  return { host, agent, deployment, workspace, outside, createAgent, patch }
}

describe('apply_patch real Host sandbox policy', () => {
  it('honors Full access despite a workspace-write deployment default', async () => {
    const f = await fixture()
    setSandboxMode(f.agent.session, 'danger-full-access')
    const file = join(f.outside, 'note.txt')
    await writeFile(file, 'before')
    expect(await f.patch(file)).toMatchObject({ isError: false, value: { exact: 1, operation: 'update' } })
    expect(await readFile(file, 'utf8')).toBe('after')
  })

  it('uses the session workspace rather than the deployment root for relative edits', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace, 'note.txt'), 'before')
    await writeFile(join(f.deployment, 'note.txt'), 'before')
    expect(await f.patch('note.txt')).toMatchObject({ isError: false })
    expect(await readFile(join(f.workspace, 'note.txt'), 'utf8')).toBe('after')
    expect(await readFile(join(f.deployment, 'note.txt'), 'utf8')).toBe('before')
  })

  it('retains read-only denial even when the deployment default is Full access', async () => {
    const f = await fixture('danger-full-access')
    setSandboxMode(f.agent.session, 'read-only')
    const file = join(f.workspace, 'note.txt')
    await writeFile(file, 'before')
    expect(await f.patch(file)).toMatchObject({ isError: true, error: { info: { code: 'FS_SANDBOX_DENIED' } } })
    expect(await readFile(file, 'utf8')).toBe('before')
  })

  it('rejects outside and symlink-escape writes under workspace-write', async () => {
    const f = await fixture()
    const file = join(f.outside, 'note.txt')
    await writeFile(file, 'before')
    await symlink(file, join(f.workspace, 'escape.txt'))
    for (const path of [file, join(f.workspace, 'escape.txt'), join(f.workspace, '..', 'outside', 'note.txt')]) {
      expect(await f.patch(path)).toMatchObject({ isError: true, error: { info: { code: 'FS_SANDBOX_DENIED' } } })
      expect(await readFile(file, 'utf8')).toBe('before')
    }
  })

  it('resolves policy anew for each call and isolates two sessions', async () => {
    const f = await fixture()
    const other = await f.createAgent(f.outside, 'read-only')
    const file = join(f.outside, 'note.txt')
    await writeFile(file, 'before')
    setSandboxMode(f.agent.session, 'danger-full-access')
    expect(await f.patch(file)).toMatchObject({ isError: false })
    expect(await f.patch(file, other, 'after', 'forbidden')).toMatchObject({ isError: true })
    setSandboxMode(f.agent.session, 'read-only')
    expect(await f.patch(file, f.agent, 'after', 'forbidden')).toMatchObject({ isError: true })
    expect(await readFile(file, 'utf8')).toBe('after')
  })

  it('a working-directory change does not widen the original workspace boundary', async () => {
    const f = await fixture()
    const file = join(f.outside, 'note.txt')
    await writeFile(file, 'before')
    await f.host.ctx.workingDirectory.set(f.agent, f.outside)
    expect(await f.patch('note.txt')).toMatchObject({ isError: true, error: { info: { code: 'FS_SANDBOX_DENIED' } } })
    expect(await readFile(file, 'utf8')).toBe('before')
    setSandboxMode(f.agent.session, 'danger-full-access')
    expect(await f.patch('note.txt')).toMatchObject({ isError: false })
    expect(await readFile(file, 'utf8')).toBe('after')
  })

  it('keeps anchor failures non-mutating under Full access', async () => {
    const f = await fixture()
    setSandboxMode(f.agent.session, 'danger-full-access')
    const file = join(f.workspace, 'note.txt')
    await writeFile(file, 'before')
    expect(await f.patch(file, f.agent, 'missing')).toMatchObject({ isError: true })
    expect(await readFile(file, 'utf8')).toBe('before')
  })

  it('agentless calls retain the deployment policy, not another session override', async () => {
    const f = await fixture()
    setSandboxMode(f.agent.session, 'danger-full-access')
    const allowed = join(f.deployment, 'note.txt')
    const denied = join(f.outside, 'note.txt')
    await writeFile(allowed, 'before')
    await writeFile(denied, 'before')
    expect(await f.patch(allowed, null)).toMatchObject({ isError: false })
    expect(await f.patch(denied, null)).toMatchObject({ isError: true, error: { info: { code: 'FS_SANDBOX_DENIED' } } })
    expect(await readFile(allowed, 'utf8')).toBe('after')
    expect(await readFile(denied, 'utf8')).toBe('before')
  })

  it('cannot widen policy through model-controlled arguments', async () => {
    const f = await fixture('danger-full-access')
    setSandboxMode(f.agent.session, 'read-only')
    const file = join(f.workspace, 'note.txt')
    await writeFile(file, 'before')
    const result = await f.host.tools.execute({
      callId: ToolCallId(randomUUID()),
      name: 'apply_patch',
      arguments: { path: file, edits: [{ old: 'before', new: 'after' }], sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: f.workspace } },
      agent: f.agent,
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ isError: true })
    expect(await readFile(file, 'utf8')).toBe('before')
  })

  it('still works with a bare local filesystem', async () => {
    const f = await fixture('workspace-write', false, false)
    const file = join(f.workspace, 'note.txt')
    await writeFile(file, 'before')
    expect(await f.patch(file)).toMatchObject({ isError: false })
    expect(await readFile(file, 'utf8')).toBe('after')
  })
})
