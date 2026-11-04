import { Context, Duration, Effect, Layer, Stream } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import type { RegistryEntry } from './api.js'
import { McpCatalogModel } from './catalog.js'
import { RegistrySearchFailed } from './errors.js'

const REQUEST_TIMEOUT = Duration.seconds(8)
const decoder = new TextDecoder()

/** Reads a response body, failing once it grows past the Registry size cap. */
const boundedText = <E>(body: Stream.Stream<Uint8Array, E>) =>
  Stream.runFoldEffect(
    body,
    () => new Uint8Array(),
    (collected, chunk) => {
      if (collected.length + chunk.length > McpCatalogModel.maxRegistryBytes) return Effect.fail(new RegistrySearchFailed({ reason: 'too-large' }))
      const joined = new Uint8Array(collected.length + chunk.length)
      joined.set(collected)
      joined.set(chunk, collected.length)
      return Effect.succeed(joined)
    },
  ).pipe(Effect.map(bytes => decoder.decode(bytes)))

/** Public MCP Registry search: one `mcp registry search` span with the host, status and result count, never the query. */
export class RegistrySearch extends Context.Service<
  RegistrySearch,
  { readonly search: (query: string) => Effect.Effect<ReadonlyArray<RegistryEntry>, RegistrySearchFailed> }
>()('@dshfiles/mcp-servers/RegistrySearch') {
  static readonly layer = Layer.effect(
    RegistrySearch,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      const search = Effect.fn('mcp registry search')(function* (query: string) {
        const url = McpCatalogModel.registryUrl(query)
        yield* Effect.annotateCurrentSpan({ 'server.address': url.host })
        const response = yield* client.execute(HttpClientRequest.get(url, { headers: { accept: 'application/json' } })).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.mapError(cause => new RegistrySearchFailed({ reason: 'request', cause })),
        )
        yield* Effect.annotateCurrentSpan({ 'http.response.status_code': response.status })
        if (response.status < 200 || response.status >= 300) return yield* new RegistrySearchFailed({ reason: 'status' })
        const text = yield* boundedText(response.stream).pipe(
          Effect.mapError(cause => (cause instanceof RegistrySearchFailed ? cause : new RegistrySearchFailed({ reason: 'request', cause }))),
        )
        const rows = McpCatalogModel.registryRows(text).slice(0, 20)
        yield* Effect.annotateCurrentSpan({ 'dshx.mcp-servers.results': rows.length })
        return rows
      })

      return RegistrySearch.of({ search })
    }),
  )
}
