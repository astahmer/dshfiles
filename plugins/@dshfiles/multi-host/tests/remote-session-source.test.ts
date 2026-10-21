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
  let released = 0
  let streamed: unknown[] = [{ type: 'snapshot', cursor: 0, records: [], hasMore: false, projections: { asOfSeq: 0, values: {} } }]
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
      if (method === 'list') return { items: [row('session-remote')] }
      if (method === 'page') return { records: [], hasMore: false }
      if (method === 'projections') return { kind: 'sequenced', asOfSeq: 0, values: {} }
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
    acquire: async () => ({
      gateway,
      generation: 1,
      release: () => {
        released += 1
      },
    }),
    run: async (_runtimeId, request) => request(gateway),
  }
  return {
    runtimes,
    calls,
    setStreamed: (frames: unknown[]) => {
      streamed = frames
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
    expect(fixture.calls).toEqual([{ method: 'list', args: { _request: { projections: ['title'] } } }])
    await expect(source.owns('session-remote' as SessionId)).resolves.toBe(true)
    await expect(source.owns('session-unknown' as SessionId)).resolves.toBe(false)
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
