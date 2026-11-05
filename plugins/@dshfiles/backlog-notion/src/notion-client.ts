import { BacklogProviderFailed, type ProviderConnection } from '@dshfiles/backlog/backlog-provider'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Ref, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

/** The Notion API version every request pins: data sources (2025-09-03) and `in_trash` (2026-03-11). */
const NOTION_VERSION = '2026-03-11'
const NOTION_ENDPOINT = 'https://api.notion.com'
const LABEL = 'Notion'
const ENVIRONMENT_VARIABLES = ['NOTION_API_KEY'] as const
const TIMEOUT = '20 seconds'
/** Notion allows an average of three requests per second per connection; one every 340 ms stays under it. */
const MIN_INTERVAL_MS = 340
const MAX_RETRIES = 3
const MAX_RETRY_AFTER_SECONDS = 60

const errorBodySchema = Schema.Struct({ code: Schema.optionalKey(Schema.String), message: Schema.optionalKey(Schema.String) })

export interface NotionRequest {
  readonly connection: ProviderConnection
  readonly method: 'GET' | 'POST' | 'PATCH'
  /** The path under `/v1`, ids already in it. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: object
  /** A short operation name for the span: `query-data-source`, `retrieve-page`… */
  readonly operation: string
  /** What a 404 names, for the recovery message. */
  readonly reference?: string
}

export interface NotionClientOptions {
  /** Spacing between two requests of one connection; tests pass 0. */
  readonly minIntervalMs?: number
}

const failed = (code: BacklogProviderFailed['code'], detail = '', status?: number, cause?: unknown) =>
  new BacklogProviderFailed({ provider: LABEL, code, detail, ...(status !== undefined && { status }), ...(cause !== undefined && { cause }) })

/** `Retry-After` in whole seconds, capped; absent or unreadable falls back to exponential backoff. */
const retryDelay = (header: string | undefined, attempt: number): Duration.Duration => {
  const seconds = Number(header)
  if (header !== undefined && Number.isFinite(seconds) && seconds >= 0) return Duration.seconds(Math.min(seconds, MAX_RETRY_AFTER_SECONDS))
  return Duration.millis(Math.min(1_000 * 2 ** attempt, MAX_RETRY_AFTER_SECONDS * 1_000))
}

/**
 * The Notion REST client: one `notion request` span per HTTP call (operation, method, status, retries — never a URL,
 * id or key), the connection's key resolved on the Host (`secret:ALIAS`, then `NOTION_API_KEY`), a per-connection
 * spacing that keeps under Notion's three requests a second, and `Retry-After` honored on 429 and 529, which also
 * holds back the connection's next requests.
 */
export class NotionClient extends Context.Service<
  NotionClient,
  {
    readonly request: (input: NotionRequest) => Effect.Effect<unknown, BacklogProviderFailed>
    readonly credentialSource: (connection: ProviderConnection) => Effect.Effect<'reference' | 'environment', BacklogProviderFailed>
  }
>()('@dshfiles/backlog-notion/NotionClient') {
  static readonly version = NOTION_VERSION
  static readonly endpoint = NOTION_ENDPOINT
  static readonly label = LABEL
  static readonly environmentVariables = ENVIRONMENT_VARIABLES

  static readonly make = (options: NotionClientOptions = {}) =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const secrets = yield* SecretReferenceResolver
      const minInterval = options.minIntervalMs ?? MIN_INTERVAL_MS
      const nextSlot = yield* Ref.make(new Map<string, number>())

      const keyOf = Effect.fnUntraced(function* (connection: ProviderConnection) {
        const reference = connection.credential.trim()
        const environment = ENVIRONMENT_VARIABLES.map(name => ({ name, value: process.env[name] ?? '' })).find(variable => variable.value !== '')
        const resolved = yield* secrets
          .resolveWithLabel({
            referenceText: reference,
            environmentValue: environment?.value,
            environmentVariableName: environment?.name ?? ENVIRONMENT_VARIABLES[0],
          })
          .pipe(Effect.catch(cause => Effect.fail(failed('credential-missing', 'the Secret Catalog could not resolve the reference', undefined, cause))))
        if (Option.isNone(resolved))
          return yield* failed('credential-missing', `no key is bound and ${ENVIRONMENT_VARIABLES.join(' or ')} is not set on the Host`)
        return { key: Redacted.make(resolved.value.value), source: reference === '' ? ('environment' as const) : ('reference' as const) }
      })

      /** Waits for this connection's next slot and books the one after it. */
      const throttle = (connection: string, holdMs = 0) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const wait = yield* Ref.modify(nextSlot, slots => {
            const slot = Math.max(now + holdMs, slots.get(connection) ?? 0)
            return [slot - now, new Map(slots).set(connection, slot + minInterval)] as const
          })
          if (wait > 0) yield* Effect.sleep(Duration.millis(wait))
        })

      const baseOf = (connection: ProviderConnection) => (connection.baseUrl.trim() === '' ? NOTION_ENDPOINT : connection.baseUrl.trim()).replace(/\/+$/u, '')

      const request = (input: NotionRequest) =>
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({
            'dshx.plugin.package': '@dshfiles/backlog-notion',
            'dshx.backlog.sync.provider': 'notion',
            'notion.operation': input.operation,
            'http.request.method': input.method,
          })
          const credential = yield* keyOf(input.connection)
          const base = HttpClientRequest.make(input.method)(`${baseOf(input.connection)}/v1${input.path}`).pipe(
            HttpClientRequest.setUrlParams(input.query ?? {}),
            HttpClientRequest.setHeaders({
              authorization: `Bearer ${Redacted.value(credential.key)}`,
              'notion-version': NOTION_VERSION,
              accept: 'application/json',
            }),
          )
          const httpRequest = input.body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, input.body)
          for (let attempt = 0; ; attempt += 1) {
            yield* throttle(input.connection.instanceId)
            const response = yield* http.execute(httpRequest).pipe(
              Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(failed('transport', 'timed out')) }),
              Effect.catchTag('HttpClientError', cause => Effect.fail(failed('transport', '', undefined, cause))),
            )
            const json = yield* response.json.pipe(Effect.orElseSucceed(() => null))
            if (response.status === 429 || response.status === 529) {
              const delay = retryDelay(response.headers['retry-after'], attempt)
              yield* Effect.annotateCurrentSpan({ 'notion.retries': attempt + 1, 'http.response.status_code': response.status })
              if (attempt >= MAX_RETRIES) return yield* failed('rejected', 'still rate-limited after retrying', 429)
              yield* throttle(input.connection.instanceId, Duration.toMillis(delay))
              continue
            }
            yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
            if (response.status >= 200 && response.status < 300) return json
            const error = Schema.decodeUnknownOption(errorBodySchema)(json)
            const message = Option.match(error, { onNone: () => '', onSome: body => body.message ?? body.code ?? '' })
            yield* Effect.annotateCurrentSpan(
              'error.type',
              Option.match(error, { onNone: () => String(response.status), onSome: body => body.code ?? String(response.status) }),
            )
            if (response.status === 404)
              return yield* failed('not-found', `${input.reference ?? ''} — share the page or database with the integration if it exists`.trim())
            if (response.status >= 500) return yield* failed('transport', message, response.status)
            return yield* failed('rejected', message, response.status)
          }
        }).pipe(Effect.withSpan('notion request', { kind: 'client' }))

      return NotionClient.of({ request, credentialSource: connection => Effect.map(keyOf(connection), credential => credential.source) })
    })

  static readonly layer = (options: NotionClientOptions = {}) => Layer.effect(NotionClient, NotionClient.make(options))
}
