import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { McpExecutables } from './host-promise.js'
import { LocalCommands } from './local-process.js'
import { RegistrySearch } from './registry-search.js'

const registryPayload = {
  servers: [
    { server: { name: 123, remotes: [] } },
    {
      server: {
        name: 'io.example/weather',
        title: 'Weather',
        description: 'Forecast tools',
        version: '1.2.0',
        _meta: { 'com.example': { category: ['weather', 'development'], documentationUrl: 'https://docs.example.com/weather' } },
        remotes: [
          { type: 'streamable-http', url: 'https://api.example.com/mcp?token=do-not-return' },
          { type: 'streamable-http', url: 'https://api.example.com/mcp' },
        ],
      },
    },
  ],
}

type RecordedRequest = { readonly url: string; readonly init: RequestInit | undefined }

/** The public Registry is an external system: its HTTP answer is replaced, the client and parsing stay real. */
const registryAnswering = (requests: Array<RecordedRequest>, body: string) =>
  Effect.map(Layer.build(RegistrySearch.layer.pipe(Layer.provide(FetchHttpClient.layer))), services => {
    const registry = Context.get(services, RegistrySearch)
    return (query: string) =>
      registry.search(query).pipe(
        Effect.provideService(FetchHttpClient.Fetch, async (input: string | URL | Request, init?: RequestInit) => {
          requests.push({ url: String(input), init })
          return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
        }),
      )
  })

describe('registry search', () => {
  it.live('queries the official Registry and maps only safe streamable HTTP endpoints', () =>
    Effect.gen(function* () {
      const requests: Array<RecordedRequest> = []
      const search = yield* registryAnswering(requests, JSON.stringify(registryPayload))
      const rows = yield* search('weather')
      expect(rows).toEqual([
        {
          name: 'io.example/weather',
          title: 'Weather',
          category: 'weather',
          description: 'Forecast tools',
          version: '1.2.0',
          endpoint: 'https://api.example.com/mcp',
          docsUrl: 'https://docs.example.com/weather',
        },
      ])
      const request = new URL(requests[0]?.url ?? '')
      expect(request.searchParams.get('search')).toBe('weather')
      expect(request.searchParams.get('version')).toBe('latest')
      expect(request.searchParams.get('limit')).toBe('20')
      expect(requests[0]?.init?.redirect).toBe('error')
      expect(JSON.stringify(rows)).not.toContain('do-not-return')
    }).pipe(Effect.scoped),
  )

  it.live('refuses a response larger than the Registry cap', () =>
    Effect.gen(function* () {
      const search = yield* registryAnswering([], ' '.repeat(1_000_001))
      const error = yield* Effect.flip(search('weather'))
      expect(error.message).toBe('Registry response is too large.')
    }).pipe(Effect.scoped),
  )
})

describe('mcp-servers spans', () => {
  it.live('records an mcp registry search span with the status and result count, never the query', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const search = yield* registryAnswering([], JSON.stringify({ servers: [] }))
      expect(yield* search('synthetic private query').pipe(Effect.provide(DshxEffect.tracerLayer))).toEqual([])
      const span = recorder.span('mcp registry search')
      expect(span.attributes).toMatchObject({ 'http.response.status_code': 200, 'dshx.mcp-servers.results': 0 })
      expect(JSON.stringify(span.attributes)).not.toContain('synthetic private query')
    }).pipe(Effect.scoped),
  )

  it.live('records an mcp server start span with the argument count, never argv or environment', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        created => Effect.promise(() => created.dispose()),
      )
      yield* Effect.promise(() => host.ctx.plugin(LocalSubprocessRuntime))
      const services = yield* Layer.build(
        LocalCommands.layer.pipe(
          Layer.provide(Layer.mergeAll(DshChildProcessSpawner.layer, McpExecutables.layer)),
          Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/mcp-servers' })),
        ),
      )
      yield* Context.get(services, LocalCommands)
        .start({ id: 'one', command: { command: 'sh', args: ['-c', 'exit 0'], cwd: process.cwd() }, env: { TOKEN: 'secret-never-render' } })
        .pipe(Effect.provide(DshxEffect.tracerLayer), Effect.scoped)
      const span = recorder.span('mcp server start')
      expect(span.attributes['dshx.mcp-servers.argument_count']).toBe(2)
      expect(JSON.stringify(span.attributes)).not.toMatch(/exit 0|secret-never-render/)
    }).pipe(Effect.scoped),
  )
})
