import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Gateway } from '../src/connectors/gateway.js'
import { createRemoteSessionSource, type RemoteRuntimes } from '../src/remote-session-source.js'

const row = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  updatedAt: 100,
  running: false,
  blank: false,
  agentAvailable: true,
  cwd: '/remote/repo',
  projections: { values: { title: 'remote thread' } },
  ...extra,
})

const runtimeFixture = () => {
  const calls: { method: string; args: unknown }[] = []
  const routedCalls: { method: string; mutation: boolean }[] = []
  let released = 0
  let streamed: unknown[] = [{ type: 'snapshot', cursor: 0, records: [], hasMore: false, projections: { asOfSeq: 0, values: {} } }]
  let recordedSessions: { readonly sessionId: string; readonly runtimeId: string; readonly cwd?: string }[] = []
  const gateway: Gateway = {
    origin: 'http://127.0.0.1:1',
    launchUrl: 'http://127.0.0.1:1/?token=test',
    closed: new Promise(() => {}),
    stream: () => ({
      [Symbol.asyncIterator]: async function* () {
        yield* streamed
      },
    }),
    run: async (_namespace: string, method: string, args: Record<string, unknown>) => {
      calls.push({ method, args })
      if (method === 'list') return { items: [row('session-remote', { transportSecret: 'discard me' })] }
      if (method === 'page') return { records: [], hasMore: false }
      if (method === 'projections')
        return {
          kind: 'sequenced',
          asOfSeq: 4,
          values: {
            modelSelection: { lastUsed: { provider: 'deepseek', model: 'chat' }, next: { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' } },
          },
        }
      if (method === 'selectModel') return { selected: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } }
      if (method === 'create') return { sessionId: 'session-created' }
      return { accepted: true }
    },
    runSafe: async () => ({ ok: true, value: undefined }),
    api: async () => undefined,
    pluginApi: () => async () => undefined,
    follow: async () => [],
    dispose: async () => undefined,
  }
  const runtimes: RemoteRuntimes = {
    list: async () => [{ id: 'runtime-1', label: 'm1-perso' }],
    recordedSessions: async () => recordedSessions,
    acquire: async () => ({
      gateway,
      generation: 1,
      release: () => {
        released += 1
      },
    }),
    run: async (_runtimeId, request, options) => {
      const before = calls.length
      const value = await request(gateway)
      for (const call of calls.slice(before)) routedCalls.push({ method: call.method, mutation: options.mutation })
      return value
    },
  }
  return {
    runtimes,
    calls,
    routedCalls,
    setStreamed: (frames: unknown[]) => {
      streamed = frames
    },
    setRecordedSessions: (sessions: typeof recordedSessions) => {
      recordedSessions = sessions
    },
    released: () => released,
  }
}

describe('remote session source', () => {
  it('lists a runtime’s Sessions and remembers which runtime owns them', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    const rows = await source.list({ projections: ['title'] }, new AbortController().signal)
    expect(rows.map(item => String(item.sessionId))).toEqual(['session-remote'])
    expect(rows[0]).not.toHaveProperty('remoteRuntimeId')
    expect(rows[0]).not.toHaveProperty('transportSecret')
    await expect(source.runtimeIdForSession?.('session-remote')).resolves.toBe('runtime-1')
    expect(fixture.calls).toEqual([{ method: 'list', args: { _request: { projections: ['title'] } } }])
    await expect(source.owns('session-remote' as SessionId)).resolves.toBe(true)
    await expect(source.owns('session-unknown' as SessionId)).resolves.toBe(false)
    expect(fixture.calls).toEqual([
      { method: 'list', args: { _request: { projections: ['title'] } } },
      { method: 'list', args: { _request: {} } },
    ])
  })

  it('streams a followed Session through its own connection and releases it', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    const frames: unknown[] = []
    for await (const frame of source.follow?.(
      {
        address: { kind: 'session', sessionId: 'session-remote' as SessionId },
      },
      new AbortController().signal,
    ) ?? [])
      frames.push(frame)
    expect(frames).toHaveLength(1)
    expect(fixture.released()).toBe(1)
  })

  it('forwards a prompt to the owning runtime unchanged', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    const request = {
      requestId: 'request-1',
      sessionId: 'session-remote' as SessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'hello' }],
    }
    await expect(source.prompt?.(request, new AbortController().signal)).resolves.toEqual({ accepted: true })
    expect(fixture.calls.at(-1)).toEqual({ method: 'prompt', args: { request } })
  })

  it('does not retain a cached runtime when recorded ownership now names an unavailable runtime', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    await expect(source.runtimeIdForSession?.('session-remote')).resolves.toBe('runtime-1')
    fixture.setRecordedSessions([{ sessionId: 'session-remote', runtimeId: 'runtime-2' }])
    await expect(source.runtimeIdForSession?.('session-remote')).resolves.toBeUndefined()
  })

  it('recovers a newly created empty remote Session into the native source list', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    fixture.setRecordedSessions([{ sessionId: 'session-created', runtimeId: 'runtime-1', cwd: '/remote/new' }])
    const rows = await source.list({}, new AbortController().signal)
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'session-created', cwd: '/remote/new', blank: true })]))
    await expect(source.runtimeIdForSession?.('session-created')).resolves.toBe('runtime-1')
  })

  it('creates an empty remote thread without prompting it', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    const created = await fixture.runtimes.run('runtime-1', gateway => gateway.run('session', 'create', { request: { cwd: '/remote/repo' } }), {
      mutation: true,
    })
    expect(created).toEqual({ sessionId: 'session-created' })
    expect(fixture.calls).toEqual([{ method: 'create', args: { request: { cwd: '/remote/repo' } } }])
    await expect(source.owns('session-unknown' as SessionId)).resolves.toBe(false)
  })

  it('routes model selection with reasoning effort to the Session owner', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    await expect(
      source.selectModel?.({
        sessionId: 'session-remote' as SessionId,
        provider: 'deepseek',
        model: 'chat',
        reasoningEffort: 'high',
      }),
    ).resolves.toEqual({ selected: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } })
    expect(fixture.calls.at(-1)).toEqual({
      method: 'selectModel',
      args: { request: { sessionId: 'session-remote', provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } },
    })
  })

  it('reports the remote Session’s model selection from its own projections', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    const projections = await source.projections?.({ sessionId: 'session-remote' as SessionId }, new AbortController().signal)
    expect(projections).toMatchObject({
      values: {
        modelSelection: { lastUsed: { provider: 'deepseek', model: 'chat' }, next: { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' } },
      },
    })
    expect(fixture.calls.at(-1)).toEqual({ method: 'projections', args: { request: { sessionId: 'session-remote' } } })
  })

  it('carries the remote model selection in followed snapshot frames', async () => {
    const fixture = runtimeFixture()
    const remoteSelection = { lastUsed: null, next: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'medium' } }
    fixture.setStreamed([
      { type: 'snapshot', cursor: 0, records: [], hasMore: false, projections: { asOfSeq: 2, values: { modelSelection: remoteSelection } } },
    ])
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    const frames: unknown[] = []
    for await (const frame of source.follow?.({ address: { kind: 'session', sessionId: 'session-remote' as SessionId } }, new AbortController().signal) ?? [])
      frames.push(frame)
    expect(frames).toEqual([expect.objectContaining({ projections: { asOfSeq: 2, values: { modelSelection: remoteSelection } } })])
  })

  it('writes the model selection through the no-replay path and reads through the replayable one', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await source.list({}, new AbortController().signal)
    await source.projections?.({ sessionId: 'session-remote' as SessionId }, new AbortController().signal)
    await source.selectModel?.({ sessionId: 'session-remote' as SessionId, provider: 'deepseek', model: 'chat' })
    expect(fixture.routedCalls.filter(call => call.method !== 'list')).toEqual([
      { method: 'projections', mutation: false },
      { method: 'selectModel', mutation: true },
    ])
  })

  it('refuses to select a model for a Session no runtime owns', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await expect(source.selectModel?.({ sessionId: 'session-unknown' as SessionId, provider: 'deepseek', model: 'chat' })).rejects.toThrow(
      'No connected runtime owns Session session-unknown.',
    )
    expect(fixture.calls.some(call => call.method === 'selectModel')).toBe(false)
  })

  it('reports a Session no runtime owns instead of answering for it', async () => {
    const fixture = runtimeFixture()
    const source = createRemoteSessionSource({ runtimes: fixture.runtimes })
    await expect(
      source.page?.(
        {
          address: { kind: 'session', sessionId: 'session-unknown' as SessionId },
          throughSeq: 0,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('No connected runtime owns Session session-unknown.')
  })
})
