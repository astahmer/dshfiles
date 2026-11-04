import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Clock, Context, Duration, Effect, Layer, Option } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse, HttpMethod } from 'effect/http'
import { OAuthFlowFailed } from './errors.js'
import { McpOAuthModel, type Fetch, type OAuthEndpoints, type OAuthGrant, type PendingAuthorization } from './oauth.js'

const REQUEST_TIMEOUT = Duration.seconds(10)

const reasonOf = (cause: unknown, fallback: string): string => (cause instanceof Error && cause.message.length > 0 ? cause.message.slice(0, 240) : fallback)

const methodOf = (method: string | undefined): HttpMethod.HttpMethod => {
  const upper = (method ?? 'GET').toUpperCase()
  return HttpMethod.isHttpMethod(upper) ? upper : 'GET'
}

/** One oauth4webapi request over the Effect HttpClient, answered as the web `Response` the library expects. */
const webRequest = (client: HttpClient.HttpClient) => (url: string, init: RequestInit) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    const base = HttpClientRequest.make(methodOf(init.method))(url).pipe(HttpClientRequest.setHeaders(Object.fromEntries(headers)))
    const body = init.body
    const request =
      typeof body === 'string' || body instanceof URLSearchParams
        ? HttpClientRequest.bodyText(base, String(body), headers.get('content-type') ?? undefined)
        : base
    const response = yield* client
      .execute(request)
      .pipe(Effect.provideService(FetchHttpClient.RequestInit, init.redirect === undefined ? {} : { redirect: init.redirect }), Effect.timeout(REQUEST_TIMEOUT))
    return yield* Option.match(HttpClientResponse.toWeb(response), {
      onNone: () => Effect.fail(new OAuthFlowFailed({ step: 'request', reason: 'The HTTP client returned no web response.' })),
      onSome: Effect.succeed,
    })
  })

/**
 * The OAuth 2.1 flows of remote MCP servers: discovery, dynamic registration, the code exchange and refresh, with
 * every request on the plugin's HttpClient. oauth4webapi is a Promise library; this file is its only Effect edge.
 */
export class McpOAuth extends Context.Service<
  McpOAuth,
  {
    readonly discover: (serverUrl: string) => Effect.Effect<OAuthEndpoints, OAuthFlowFailed>
    readonly registerClient: (input: {
      readonly endpoints: OAuthEndpoints
      readonly redirectUri: string
      readonly clientName: string
    }) => Effect.Effect<{ readonly clientId: string; readonly clientSecret: string | undefined }, OAuthFlowFailed>
    readonly authorizationStart: Effect.Effect<{ readonly verifier: string; readonly challenge: string; readonly state: string }>
    readonly exchangeCode: (input: {
      readonly pending: PendingAuthorization
      readonly callbackParameters: URLSearchParams
    }) => Effect.Effect<OAuthGrant, OAuthFlowFailed>
    /** The grant when it is fresh enough, a refreshed one, or `None` when the user must sign in again. */
    readonly refresh: (grant: OAuthGrant) => Effect.Effect<Option.Option<OAuthGrant>>
    readonly needsRefresh: (grant: OAuthGrant) => Effect.Effect<boolean>
  }
>()('@dshfiles/mcp-servers/McpOAuth') {
  static readonly layer = Layer.effect(
    McpOAuth,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const fetcher: Fetch = yield* DshxPlugin.callback(webRequest(client))

      const discover = Effect.fn('mcp oauth discover')((serverUrl: string) =>
        Effect.tryPromise({
          try: () => McpOAuthModel.discover({ serverUrl, fetcher }),
          catch: cause => new OAuthFlowFailed({ step: 'discover', reason: reasonOf(cause, 'OAuth discovery failed.'), cause }),
        }),
      )

      const registerClient = Effect.fn('mcp oauth register')(
        (input: { readonly endpoints: OAuthEndpoints; readonly redirectUri: string; readonly clientName: string }) =>
          Effect.tryPromise({
            try: () =>
              McpOAuthModel.registerClient({
                authorizationServer: input.endpoints.authorizationServer,
                redirectUri: input.redirectUri,
                clientName: input.clientName,
                fetcher,
              }),
            catch: cause => new OAuthFlowFailed({ step: 'register', reason: reasonOf(cause, 'OAuth client registration failed.'), cause }),
          }),
      )

      const authorizationStart = Effect.promise(() => McpOAuthModel.createPkcePair()).pipe(
        Effect.map(pkce => ({ ...pkce, state: McpOAuthModel.createState() })),
      )

      const exchangeCode = Effect.fn('mcp oauth exchange')(function* (input: {
        readonly pending: PendingAuthorization
        readonly callbackParameters: URLSearchParams
      }) {
        const now = yield* Clock.currentTimeMillis
        return yield* Effect.tryPromise({
          try: () => McpOAuthModel.exchangeCode({ ...input, fetcher, now }),
          catch: cause => new OAuthFlowFailed({ step: 'exchange', reason: reasonOf(cause, 'OAuth code exchange failed.'), cause }),
        })
      })

      const needsRefresh = (grant: OAuthGrant) => Effect.map(Clock.currentTimeMillis, now => McpOAuthModel.needsRefresh({ grant, now }))

      const refresh = Effect.fn('mcp oauth refresh')(function* (grant: OAuthGrant) {
        const now = yield* Clock.currentTimeMillis
        const refreshed = yield* Effect.promise(() => McpOAuthModel.refreshGrant({ grant, fetcher, now }))
        return Option.fromUndefinedOr(refreshed)
      })

      return McpOAuth.of({ discover, registerClient, authorizationStart, exchangeCode, refresh, needsRefresh })
    }),
  )
}
