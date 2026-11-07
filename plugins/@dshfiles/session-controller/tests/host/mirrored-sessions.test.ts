import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionSourceRegistry, SessionPromptRefused, SessionSourcePayload, type MirroredSessionSource } from '@dshfiles/session-source-port'
import { MirroredSessions } from '../../src/mirrored-sessions.ts'
import type { SessionFollowFrame, SessionForkRequest, SessionRenameRequest, SessionSummary } from '../../src/native/types.ts'

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

  it('pages a cold Session this Host listed without asking any runtime whether it owns it', async () => {
    const { mirrored, source } = await fixture()
    const asked: string[] = []
    mirrored.registry.register(
      source({
        rows: [],
        owns: async sessionId => {
          asked.push(sessionId)
          return false
        },
      }),
    )
    await mirrored.merge([summary('session-cold', 100)], {}, new AbortController().signal)
    const page = { records: [], hasMore: false }
    await expect(
      mirrored.page({ address: { kind: 'session', sessionId: SessionId('session-cold') }, throughSeq: 0 }, new AbortController().signal, async () => page),
    ).resolves.toBe(page)
    expect(asked).toEqual([])
  })

  it('falls back to the local implementation when a runtime fails to answer ownership', async () => {
    const { mirrored, source } = await fixture()
    mirrored.registry.register(
      source({
        rows: [],
        owns: async () => {
          throw new Error('All fibers interrupted without error')
        },
      }),
    )
    const page = { records: [], hasMore: false }
    await expect(
      mirrored.page({ address: { kind: 'session', sessionId: SessionId('session-other') }, throughSeq: 0 }, new AbortController().signal, async () => page),
    ).resolves.toBe(page)
  })

  it('routes a mirrored Session’s model selection and projections to its source, never the local controller', async () => {
    const { mirrored, source } = await fixture()
    const selected: unknown[] = []
    mirrored.registry.register(
      source({
        rows: [summary('session-remote', 100)],
        selectModel: async request => {
          selected.push(request)
          return SessionSourcePayload.selectedModel({ selected: { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' } })
        },
        projections: async () =>
          SessionSourcePayload.projections({
            kind: 'sequenced',
            asOfSeq: 3,
            values: { modelSelection: { lastUsed: null, next: { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' } } },
          }),
      }),
    )
    await mirrored.merge([], {}, new AbortController().signal)
    const request = { sessionId: SessionId('session-remote'), provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' }
    await expect(
      mirrored.selectModel(request, async () => {
        throw new Error('local fallback must not run')
      }),
    ).resolves.toEqual({ selected: { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' } })
    expect(selected).toEqual([request])
    await expect(
      mirrored.projections({ sessionId: SessionId('session-remote') }, new AbortController().signal, async () => {
        throw new Error('local fallback must not run')
      }),
    ).resolves.toMatchObject({ values: { modelSelection: { next: { model: 'reasoner' } } } })
  })

  it('forks and renames on the owner, and keeps a local Session on this Host', async () => {
    const { mirrored, source } = await fixture()
    const forked: unknown[] = []
    mirrored.registry.register(
      source({
        rows: [summary('session-remote', 100)],
        fork: async (request: SessionForkRequest) => {
          forked.push(request)
          return { sessionId: SessionId('session-forked') }
        },
        rename: async (request: SessionRenameRequest) => ({ title: request.title, seq: 5 }),
      }),
    )
    await mirrored.merge([], {}, new AbortController().signal)
    const mustNotRun = async () => {
      throw new Error('local fallback must not run')
    }
    await expect(mirrored.fork({ sessionId: SessionId('session-remote') }, mustNotRun)).resolves.toEqual({ sessionId: 'session-forked' })
    expect(forked).toHaveLength(1)
    await expect(mirrored.rename({ sessionId: SessionId('session-remote'), title: 'New' }, mustNotRun)).resolves.toEqual({ title: 'New', seq: 5 })
    await expect(mirrored.fork({ sessionId: SessionId('session-local') }, async () => ({ sessionId: SessionId('session-here') }))).resolves.toEqual({
      sessionId: 'session-here',
    })
  })

  it('refuses model selection for a mirrored Session whose source cannot select', async () => {
    const { mirrored, source } = await fixture()
    mirrored.registry.register(source({ rows: [summary('session-remote', 100)] }))
    await mirrored.merge([], {}, new AbortController().signal)
    await expect(
      mirrored.selectModel({ sessionId: SessionId('session-remote'), provider: 'deepseek', model: 'chat' }, async () => {
        throw new Error('local fallback must not run')
      }),
    ).rejects.toMatchObject({ code: 'gateway/bad-request' })
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

  it('shows a source refusal as written, not as a runtime that did not answer', async () => {
    const { mirrored, source } = await fixture()
    mirrored.registry.register(
      source({
        rows: [summary('session-remote', 100)],
        prompt: async () => {
          throw new SessionPromptRefused({ reason: 'Attach the file to send it there.' })
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
    ).rejects.toMatchObject({ code: 'gateway/bad-request', message: 'Attach the file to send it there.' })
  })

  it('creates an empty registry the Host can provide', () => {
    const registry = createSessionSourceRegistry()
    expect(registry.sources()).toEqual([])
    expect(registry.ownerOf(SessionId('session-remote'))).toBeUndefined()
  })
})
