import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientSessions } from '../src/native/client/sessions/service.ts'
import { Session } from '../src/native/client/sessions/session.ts'
import type { SessionRemotes } from '../src/native/client/sessions/remotes.ts'

// These are consumer-owned reference labels, intentionally extensible by the Controller contract.
declare module '../src/native/client/index.ts' {
  interface SessionReferenceSourceMap {
    mainView: unknown
    sidebarView: unknown
    commandCatalog: unknown
  }
}

const contexts = new Set<Context>()
const options = { workspaceId: brandString<WorkspaceId>('workspace-test'), cwd: '/project' }
const tick = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

function fixture() {
  const ctx = new Context()
  contexts.add(ctx)
  const stream = vi.fn()
  const remote: SessionRemotes = {
    $stream: options => {
      stream(options)
      throw new Error('Unexpected history stream before creation')
    },
    commands: { execute: vi.fn<SessionRemotes['commands']['execute']>() },
    subagents: {
      prompt: vi.fn<SessionRemotes['subagents']['prompt']>(),
      interruptByParent: vi.fn<SessionRemotes['subagents']['interruptByParent']>(),
    },
    session: {
      attachment: vi.fn<SessionRemotes['session']['attachment']>(),
      cancel: vi.fn<SessionRemotes['session']['cancel']>(),
      canOpenWorkspacePath: vi.fn<SessionRemotes['session']['canOpenWorkspacePath']>(),
      control: vi.fn<SessionRemotes['session']['control']>(),
      create: vi.fn<SessionRemotes['session']['create']>(),
      follow: vi.fn<SessionRemotes['session']['follow']>(),
      fork: vi.fn<SessionRemotes['session']['fork']>(),
      initializeDefaultModel: vi.fn<SessionRemotes['session']['initializeDefaultModel']>(),
      list: vi.fn<SessionRemotes['session']['list']>(),
      modelCatalog: vi.fn<SessionRemotes['session']['modelCatalog']>(),
      openWorkspacePath: vi.fn<SessionRemotes['session']['openWorkspacePath']>(),
      page: vi.fn<SessionRemotes['session']['page']>(),
      projections: vi.fn<SessionRemotes['session']['projections']>(),
      prompt: vi.fn<SessionRemotes['session']['prompt']>(),
      rename: vi.fn<SessionRemotes['session']['rename']>(),
      search: vi.fn<SessionRemotes['session']['search']>(),
      selectModel: vi.fn<SessionRemotes['session']['selectModel']>(),
      updateQueue: vi.fn<SessionRemotes['session']['updateQueue']>(),
      workspacePathApplications: vi.fn<SessionRemotes['session']['workspacePathApplications']>(),
    },
  }
  const sessions = new ClientSessions(ctx, remote)
  return { ctx, remote, sessions, stream }
}

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  })
})

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('local view readiness and operation retention', () => {
  it('resolves local presentation synchronously even when both views release in the same turn', async () => {
    const { sessions, remote, stream } = fixture()
    const handle = sessions.drafts.create(options)
    const main = sessions.retain(handle.sessionId, { source: 'mainView' })
    const sidebar = sessions.retain(handle.sessionId, { source: 'sidebarView' })
    const binding = main.binding
    expect(binding.session.getSnapshot().openState).toBe('cold')
    main.release()
    sidebar.release()
    await expect(main.ready).resolves.toBe(binding)
    await expect(sidebar.ready).resolves.toBe(binding)
    await expect(handle.settled).rejects.toThrow('discarded')
    expect(sessions.drafts.list.getSnapshot()[handle.sessionId]).toBeUndefined()
    expect(sessions.retainInfo(handle.sessionId).getSnapshot().referenceCount).toBe(0)
    expect(stream).not.toHaveBeenCalled()
    expect(remote.session.create).not.toHaveBeenCalled()
  })

  it('waits for local creation before retaining command warmup, so final view release discards it', async () => {
    const { sessions, stream } = fixture()
    const handle = sessions.drafts.create(options)
    const main = sessions.retain(handle.sessionId, { source: 'mainView' })
    const operation = vi.fn(() => 'catalog')
    const warming = sessions.using(handle.sessionId, { source: 'commandCatalog' }, operation)
    expect(sessions.retainInfo(handle.sessionId).getSnapshot().referenceCount).toBe(1)
    main.release()
    await expect(warming).rejects.toThrow('discarded')
    await expect(handle.settled).rejects.toThrow('discarded')
    expect(operation).not.toHaveBeenCalled()
    expect(sessions.drafts.list.getSnapshot()[handle.sessionId]).toBeUndefined()
    expect(stream).not.toHaveBeenCalled()
  })

  it('cancels a pre-creation operation waiter without taking or releasing the presentation reference', async () => {
    const { sessions } = fixture()
    const handle = sessions.drafts.create(options)
    const main = sessions.retain(handle.sessionId, { source: 'mainView' })
    const controller = new AbortController()
    const operation = vi.fn()
    const warming = sessions.using(handle.sessionId, { source: 'commandCatalog', signal: controller.signal }, operation)
    controller.abort(new Error('catalog closed'))
    await expect(warming).rejects.toThrow('catalog closed')
    expect(sessions.retainInfo(handle.sessionId).getSnapshot().referenceCount).toBe(1)
    expect(operation).not.toHaveBeenCalled()
    main.release()
    await expect(handle.settled).rejects.toThrow('discarded')
  })

  it('keeps operations behind real history readiness after local materialization', async () => {
    const history = Promise.withResolvers<void>()
    const open = vi.spyOn(Session.prototype, 'open').mockImplementation(() => history.promise)
    const { sessions, remote } = fixture()
    const handle = sessions.drafts.create(options)
    vi.mocked(remote.session.create).mockResolvedValue({ ok: true, value: { sessionId: handle.sessionId } })
    const main = sessions.retain(handle.sessionId, { source: 'mainView' })
    await expect(main.ready).resolves.toBe(main.binding)
    const operation = vi.fn(() => 'catalog')
    const warming = sessions.using(handle.sessionId, { source: 'commandCatalog' }, operation)
    expect(sessions.retainInfo(handle.sessionId).getSnapshot().referenceCount).toBe(1)
    sessions.drafts.update(handle.sessionId, { text: 'typed', hasAttachments: false })
    await handle.settled
    await tick()
    expect(open).toHaveBeenCalledTimes(2)
    expect(sessions.retainInfo(handle.sessionId).getSnapshot().referenceCount).toBe(2)
    expect(operation).not.toHaveBeenCalled()
    history.resolve()
    await expect(warming).resolves.toBe('catalog')
    expect(sessions.retainInfo(handle.sessionId).getSnapshot().referenceCount).toBe(1)
    main.release()
  })

  it('cancels unretained pre-creation waiters when the Controller is disposed', async () => {
    const { sessions, ctx } = fixture()
    const handle = sessions.drafts.create(options)
    sessions.retain(handle.sessionId, { source: 'mainView' })
    const warming = sessions.using(handle.sessionId, { source: 'commandCatalog' }, () => 'never')
    const rejected = expect(warming).rejects.toThrow('disposed')
    await ctx.fiber.dispose()
    await rejected
    await expect(handle.settled).rejects.toThrow('disposed')
  })
})
