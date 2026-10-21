import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionSourceRegistry, SessionSourcePayload, type MirroredSessionSource } from '@dshfiles/session-source-port'
import { MirroredSessions } from '../../src/mirrored-sessions.ts'
import type { SessionFollowFrame, SessionSummary } from '../../src/native/types.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

const summary = (sessionId: string, updatedAt: number, running = false): SessionSummary => ({
  sessionId: SessionId(sessionId),
  updatedAt,
  running,
  blank: false,
  agentAvailable: false,
})

const fixture = async () => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  const mirrored = new MirroredSessions(ctx)
  mirrored.provide()
  const added: SessionSummary[] = []
  const statuses: [string, boolean][] = []
  ctx.on('api-session/added', row => {
    added.push(row)
  })
  ctx.on('api-session/status', (sessionId, running) => {
    statuses.push([sessionId, running])
  })
  const registry = ctx.get('sessionSources')
  const source = (overrides: Partial<MirroredSessionSource> & { readonly rows: readonly SessionSummary[] }): MirroredSessionSource => ({
    id: 'remote',
    label: 'remote',
    list: async () => overrides.rows,
    owns: sessionId => overrides.rows.some(row => row.sessionId === sessionId),
    ...overrides,
  })
  return { ctx, mirrored, added, statuses, registry, source }
}

describe('mirrored sessions', () => {
  it('merges source rows after the local ones, claims them, and announces each new row once', async () => {
    const { mirrored, added, source } = await fixture()
    const remote = source({ rows: [summary('session-remote', 200)] })
    mirrored.registry.register(remote)
    const signal = new AbortController().signal

    const merged = await mirrored.merge([summary('session-local', 100)], {}, signal)
    expect(merged.map(row => String(row.sessionId))).toEqual(['session-remote', 'session-local'])
    expect(mirrored.ownerOf(SessionId('session-remote'))).toBe(remote)
    expect(added.map(row => String(row.sessionId))).toEqual(['session-remote'])

    await mirrored.merge([summary('session-local', 100)], {}, signal)
    expect(added).toHaveLength(1)
  })

  it('keeps the local row when a source reports the same id', async () => {
    const { mirrored, source } = await fixture()
    mirrored.registry.register(source({ rows: [summary('session-shared', 200)] }))
    const merged = await mirrored.merge([summary('session-shared', 100)], {}, new AbortController().signal)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.updatedAt).toBe(100)
  })

  it('survives a source whose list rejects', async () => {
    const { mirrored, source } = await fixture()
    mirrored.registry.register(
      source({
        rows: [],
        list: async () => {
          throw new Error('host offline')
        },
      }),
    )
    const merged = await mirrored.merge([summary('session-local', 100)], {}, new AbortController().signal)
    expect(merged.map(row => String(row.sessionId))).toEqual(['session-local'])
  })

  it('announces a changed running state of an already listed row', async () => {
    const { mirrored, statuses, source } = await fixture()
    let running = false
    const rows = [summary('session-remote', 100)]
    mirrored.registry.register(
      source({
        rows,
        list: async () => [{ ...summary('session-remote', 100), running }],
      }),
    )
    const signal = new AbortController().signal
    await mirrored.merge([], {}, signal)
    running = true
    await mirrored.merge([], {}, signal)
    expect(statuses).toEqual([['session-remote', true]])
  })

  it('forwards follow frames from the owning runtime', async () => {
    const { mirrored, source } = await fixture()
    const frames: SessionFollowFrame[] = [
      SessionSourcePayload.followFrame({
        type: 'snapshot',
        header: { version: 1, id: 'session-remote', createdAt: 1 },
        cursor: 0,
        records: [],
        hasMore: false,
        projections: { asOfSeq: 0, values: {} },
      }),
    ]
    const remote = source({
      rows: [summary('session-remote', 100)],
      follow: async function* () {
        yield* frames
      },
    })
    mirrored.registry.register(remote)
    await mirrored.merge([], {}, new AbortController().signal)
    const received: SessionFollowFrame[] = []
    for await (const frame of mirrored.follow({ address: { kind: 'session', sessionId: SessionId('session-remote') } }, new AbortController().signal, () => {
      throw new Error('local fallback must not run')
    }))
      received.push(frame)
    expect(received).toEqual(frames)
  })

  it('falls back to the local implementation for a Session this Host holds', async () => {
    const { ctx, mirrored } = await fixture()
    ctx.sessions.prepare(SessionId('session-local'), { meta: { createdAt: 1 } })
    const fallback = 'local'
    await expect(
      mirrored.prompt(
        { requestId: 'request-1' as never, sessionId: SessionId('session-local'), mode: 'queue', content: [{ type: 'text', text: 'hi' }] },
        new AbortController().signal,
        async () => ({ accepted: true, via: fallback }) as never,
      ),
    ).resolves.toEqual({ accepted: true, via: 'local' })
  })

  it('reports a source failure with a stable gateway code', async () => {
    const { mirrored, source } = await fixture()
    mirrored.registry.register(
      source({
        rows: [summary('session-remote', 100)],
        prompt: async () => {
          throw new Error('tunnel closed')
        },
      }),
    )
    await mirrored.merge([], {}, new AbortController().signal)
    await expect(
      mirrored.prompt(
        { requestId: 'request-1' as never, sessionId: SessionId('session-remote'), mode: 'queue', content: [{ type: 'text', text: 'hi' }] },
        new AbortController().signal,
        async () => ({ accepted: true }),
      ),
    ).rejects.toMatchObject({ code: 'gateway/internal', message: expect.stringContaining('tunnel closed') })
  })

  it('creates an empty registry the Host can provide', () => {
    const registry = createSessionSourceRegistry()
    expect(registry.sources()).toEqual([])
    expect(registry.ownerOf(SessionId('session-remote'))).toBeUndefined()
  })
})
