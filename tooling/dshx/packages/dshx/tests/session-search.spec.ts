import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { runCli } from '../src/cli/run.js'
import { createDshPlatformClientFromTransport, DshPlatformError, type DshPlatformClient, type DshPlatformTransport } from '../src/platform/client.js'
import { SessionSearchModel } from '../src/platform/session-search.js'
import type { CliIO } from '../src/cli/run.js'

const io = (): CliIO & { readonly stdout: PassThrough; readonly stderr: PassThrough } => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  return { stdin, stdout, stderr }
}

const capture = (stream: PassThrough): (() => string) => {
  let value = ''
  stream.on('data', chunk => {
    value += chunk.toString()
  })
  return () => value
}

const instability = (): DshPlatformError =>
  new DshPlatformError('gateway/internal', 'session search failed: SessionQueryError: session-search persistence observation did not stabilize after one retry')

describe('session search resilience', () => {
  it('recognizes the transient observation failure in both the typed and the RPC-wrapped shape', () => {
    expect(SessionSearchModel.isTransientFailure({ code: 'SESSION_QUERY_PERSISTENCE_FAILED', message: 'did not stabilize' })).toBe(true)
    expect(SessionSearchModel.isTransientFailure(instability())).toBe(true)
    expect(SessionSearchModel.isTransientFailure(new DshPlatformError('gateway/internal', 'session search failed: something else'))).toBe(false)
    expect(SessionSearchModel.isTransientFailure(new DshPlatformError('SESSION_QUERY_SEARCH_DISABLED', 'full-text search is disabled'))).toBe(false)
    expect(SessionSearchModel.isFatalFailure(new DshPlatformError('authentication-expired', 'nope'))).toBe(true)
  })

  it('retries the transient failure and reports the content source', async () => {
    let calls = 0
    const outcome = await SessionSearchModel.searchResilient({
      query: 'synthetic',
      search: async () => {
        calls += 1
        if (calls < 3) throw instability()
        return { items: [{ sessionId: 'session-1', snippet: 'synthetic match' }], hasMore: false }
      },
      list: async () => [],
      sleep: async () => {},
    })
    expect(calls).toBe(3)
    expect(outcome).toMatchObject({ source: 'session-content', incomplete: false, attempts: 3, failure: null })
    expect(outcome.items.map(item => item.sessionId)).toEqual(['session-1'])
  })

  it('falls back to a labeled metadata page when the content search keeps failing', async () => {
    let calls = 0
    const outcome = await SessionSearchModel.searchResilient({
      query: 'thread search',
      search: async () => {
        calls += 1
        throw instability()
      },
      list: async () => [
        { sessionId: 'session-1', updatedAt: 20, projections: { kind: 'sequenced', asOfSeq: 4, values: { title: 'Thread search plan' } } },
        { sessionId: 'session-2', updatedAt: 30, projections: { kind: 'sequenced', asOfSeq: 4, values: { title: 'Unrelated work' } } },
      ],
      sleep: async () => {},
    })
    expect(calls).toBe(3)
    expect(outcome.source).toBe('session-metadata')
    expect(outcome.incomplete).toBe(true)
    expect(outcome.failure?.code).toBe('gateway/internal')
    expect(outcome.items).toEqual([{ sessionId: 'session-1', snippet: 'Thread search plan', evidence: ['title-match'] }])
  })

  it('does not retry a disabled index and still answers from metadata', async () => {
    let calls = 0
    const outcome = await SessionSearchModel.searchResilient({
      query: 'session-2',
      search: async () => {
        calls += 1
        throw new DshPlatformError('SESSION_QUERY_SEARCH_DISABLED', 'full-text search is disabled')
      },
      list: async () => [{ sessionId: 'session-2', updatedAt: 5 }],
      sleep: async () => {},
    })
    expect(calls).toBe(1)
    expect(outcome.items).toEqual([{ sessionId: 'session-2', snippet: 'session-2', evidence: ['identifier'] }])
  })

  it('rethrows failures a metadata fallback cannot answer', async () => {
    await expect(
      SessionSearchModel.searchResilient({
        query: 'synthetic',
        search: async () => {
          throw new DshPlatformError('authentication-expired', 'copy the current URL')
        },
        list: async () => [],
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'authentication-expired' })
  })

  it('matches titles, identifiers and terms over metadata only, newest first within one score', () => {
    const summaries = [
      { sessionId: 'session-a', updatedAt: 10, cwd: '/dev/other', projections: { values: { title: 'Alpha plan' } } },
      { sessionId: 'session-b', updatedAt: 30, cwd: '/dev/dshfiles', projections: { values: { title: 'Alpha plan' } } },
      { sessionId: 'session-c', updatedAt: 40, projections: { values: { title: null } } },
    ]
    expect(SessionSearchModel.metadataMatches(summaries, 'alpha', 5).map(item => item.sessionId)).toEqual(['session-b', 'session-a'])
    expect(SessionSearchModel.metadataMatches(summaries, 'dshfiles', 5)).toEqual([{ sessionId: 'session-b', snippet: 'Alpha plan', evidence: ['identifier'] }])
    expect(SessionSearchModel.metadataMatches(summaries, 'session-c', 5)).toEqual([{ sessionId: 'session-c', snippet: 'session-c', evidence: ['identifier'] }])
    expect(SessionSearchModel.metadataMatches(summaries, 'nothing here', 5)).toEqual([])
  })

  it('decodes the Host title projection defensively', () => {
    expect(SessionSearchModel.titleOf({ projections: { kind: 'sequenced', values: { title: 'Ready' } } })).toBe('Ready')
    expect(SessionSearchModel.titleOf({ projections: { values: { title: null } } })).toBeUndefined()
    expect(SessionSearchModel.titleOf({ projections: { summary: 'no values' } })).toBeUndefined()
    expect(SessionSearchModel.titleOf({})).toBeUndefined()
  })
})

describe('sessions search CLI', () => {
  const clientWith = (transport: Partial<DshPlatformTransport> & Pick<DshPlatformTransport, 'rpc'>): DshPlatformClient =>
    createDshPlatformClientFromTransport({ sessionCursor: async () => 0, ...transport })

  it('survives the transient failure and prints the matching Session', async () => {
    const streams = io()
    const stdout = capture(streams.stdout)
    const stderr = capture(streams.stderr)
    let calls = 0
    const client = clientWith({
      rpc: async (namespace, method) => {
        if (namespace === 'session' && method === 'search') {
          calls += 1
          if (calls === 1) throw instability()
          return { items: [{ sessionId: 'session-1', snippet: 'synthetic match' }], hasMore: false }
        }
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
    })
    const exitCode = await runCli(['sessions', 'search', 'synthetic'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    expect(exitCode).toBe(0)
    expect(calls).toBe(2)
    expect(stdout()).toContain('session-1')
    expect(stderr()).toBe('')
  })

  it('prints a labeled metadata page instead of failing or pretending the page is complete', async () => {
    const streams = io()
    const stdout = capture(streams.stdout)
    const client = clientWith({
      rpc: async (namespace, method) => {
        if (namespace === 'session' && method === 'search') throw instability()
        if (namespace === 'session' && method === 'list') {
          return {
            items: [
              {
                sessionId: 'session-1',
                updatedAt: 10,
                running: false,
                blank: false,
                agentAvailable: true,
                projections: { kind: 'sequenced', asOfSeq: 2, values: { title: 'Thread search plan' } },
              },
            ],
          }
        }
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
    })
    const exitCode = await runCli(['sessions', 'search', 'thread search'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    expect(exitCode).toBe(0)
    expect(stdout()).toContain('Thread search plan')
    expect(stdout()).toContain('degraded')
    expect(stdout()).toContain('title/metadata matches only')
  })

  it('fails with a typed actionable error rather than a false empty page', async () => {
    const streams = io()
    const stderr = capture(streams.stderr)
    const client = clientWith({
      rpc: async (namespace, method) => {
        if (namespace === 'session' && method === 'search') throw instability()
        if (namespace === 'session' && method === 'list') return { items: [] }
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
    })
    const exitCode = await runCli(['sessions', 'search', 'nothing matches'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr()).toContain('Session content search is unavailable')
    expect(stderr()).toContain('Retry shortly')
  })

  it('uses the composed finder when the installed Memory plugin serves it', async () => {
    const streams = io()
    const stdout = capture(streams.stdout)
    const client = clientWith({
      rpc: async (namespace, method) => {
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
      findThreads: async () => ({
        kind: 'page',
        page: {
          hits: [
            {
              sessionId: 'session-1',
              title: 'Thread search plan',
              createdAt: 1,
              updatedAt: 2,
              cwd: '/dev/dshfiles',
              project: '/dev/dshfiles',
              live: true,
              persisted: true,
              parentSessionId: null,
              snippet: '…another thread mentioning it…',
              sources: ['session-title', 'session-content'],
              evidence: ['exact-title', 'text-match'],
              score: 1_000,
            },
          ],
          notes: [],
          nextCursor: null,
          degraded: [],
          diagnostics: { correlationId: 'c1', elapsedMs: 4, sources: ['session-title', 'session-content'], attempts: 1, scannedSessions: 2, incomplete: false },
          project: '/dev/dshfiles',
        },
      }),
    })
    const exitCode = await runCli(['sessions', 'search', 'thread search plan'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    expect(exitCode).toBe(0)
    expect(stdout()).toContain('session-title+session-content')
    expect(stdout()).toContain('exact-title, text-match')
  })

  it('reports a degraded finder page and its cursor without searching the core RPC again', async () => {
    const streams = io()
    const stdout = capture(streams.stdout)
    let rpcCalls = 0
    const client = clientWith({
      rpc: async (namespace, method) => {
        rpcCalls += 1
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
      findThreads: async () => ({
        kind: 'page',
        page: {
          hits: [],
          notes: [],
          nextCursor: 'cursor-2',
          degraded: [{ source: 'session-content', code: 'SESSION_QUERY_PERSISTENCE_FAILED', attempts: 4, elapsedMs: 9, message: 'did not stabilize' }],
          diagnostics: { correlationId: 'c2', elapsedMs: 9, sources: ['session-metadata'], attempts: 4, scannedSessions: 9, incomplete: true },
          project: '/dev/dshfiles',
        },
      }),
    })
    const exitCode = await runCli(['sessions', 'search', 'nothing'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    expect(exitCode).toBe(0)
    expect(rpcCalls).toBe(0)
    expect(stdout()).toContain('degraded')
    expect(stdout()).toContain('cursor-2')
  })

  it('reports a failing finder instead of silently degrading', async () => {
    const streams = io()
    const stderr = capture(streams.stderr)
    const client = clientWith({
      rpc: async () => {
        throw new Error('unexpected')
      },
      findThreads: async () => ({
        kind: 'failed',
        error: new DshPlatformError('remote-error', 'Session content search is unavailable (SESSION_QUERY_PERSISTENCE_FAILED).'),
      }),
    })
    const exitCode = await runCli(['sessions', 'search', 'nothing'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr()).toContain('Session content search is unavailable')
  })

  it('reports the finder unavailable failure as the documented session-search-unavailable code', async () => {
    const streams = io()
    const stderr = capture(streams.stderr)
    const client = clientWith({
      rpc: async () => {
        throw new Error('unexpected')
      },
      findThreads: async () => ({
        kind: 'failed',
        error: new DshPlatformError(
          'search-unavailable',
          'Session content search is unavailable (SESSION_QUERY_SEARCH_DISABLED after 1 attempt(s)) and no session matched by title, workspace, or memory. Retry shortly or narrow the query.',
        ),
      }),
    })
    const exitCode = await runCli(['sessions', 'search', 'nothing'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr()).toContain('session-search-unavailable')
    expect(stderr()).toContain('Retry shortly or narrow the query')
  })
})
