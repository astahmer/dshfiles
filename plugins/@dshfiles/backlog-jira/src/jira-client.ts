import { BacklogProviderFailed, type ProviderConnection } from '@dshfiles/backlog/backlog-provider'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Ref, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

const LABEL = 'Jira'
const TOKEN_VARIABLES = ['JIRA_API_TOKEN'] as const
const EMAIL_VARIABLE = 'JIRA_EMAIL'
const TIMEOUT = '20 seconds'
/** Jira Cloud meters API-token traffic in bursts; one request every 100 ms per connection stays well inside them. */
const MIN_INTERVAL_MS = 100
const MAX_RETRIES = 3
const MAX_RETRY_AFTER_SECONDS = 60
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

const errorBodySchema = Schema.Struct({
  errorMessages: Schema.optionalKey(Schema.Array(Schema.String)),
  errors: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

export interface JiraRequest {
  readonly connection: ProviderConnection
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** The path under `/rest/api/3`, keys and ids already validated into it. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: object
  /** A short operation name for the span: `search-issues`, `transition-issue`… */
  readonly operation: string
  /** What a 404 names, for the recovery message. */
  readonly reference?: string
}

export interface JiraClientOptions {
  /** Spacing between two requests of one connection; tests pass 0. */
  readonly minIntervalMs?: number
}

const failed = (code: BacklogProviderFailed['code'], detail = '', status?: number, cause?: unknown) =>
  new BacklogProviderFailed({ provider: LABEL, code, detail, ...(status !== undefined && { status }), ...(cause !== undefined && { cause }) })

/** `Retry-After` in whole seconds, capped; absent or unreadable falls back to exponential backoff. */
const retryDelay = (header: string | undefined, attempt: number): Duration.Duration => {
  const seconds = Number(header)
  if (header !== undefined && header.trim() !== '' && Number.isFinite(seconds) && seconds >= 0)
    return Duration.seconds(Math.min(seconds, MAX_RETRY_AFTER_SECONDS))
  return Duration.millis(Math.min(1_000 * 2 ** attempt, MAX_RETRY_AFTER_SECONDS * 1_000))
}

/** The site's origin: https, or http only on loopback (a test server), so the key never crosses a network in clear. */
const siteOf = (connection: ProviderConnection) => {
  const raw = connection.baseUrl.trim()
  if (raw === '') return Effect.fail(failed('target-missing', "set the connection's API base URL to your site, https://<site>.atlassian.net"))
  if (!URL.canParse(raw)) return Effect.fail(failed('target-missing', 'the API base URL is not a URL; use https://<site>.atlassian.net'))
  const url = new URL(raw)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
    return Effect.fail(failed('target-missing', 'the API base URL must use https so the API token is never sent in clear'))
  return Effect.succeed(`${url.origin}${url.pathname.replace(/\/+$/u, '')}`)
}

/**
 * The Jira Cloud REST v3 client: Basic auth with the connection's account email and API token
 * (https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/), the token resolved on the Host
 * (`secret:ALIAS`, then `JIRA_API_TOKEN`), a per-connection spacing, and `Retry-After` honored on 429 and 503, which
 * also holds back that connection's next requests. One `jira request` span per HTTP call carries the operation,
 * method, status and retries — never a URL, key, email or token.
 */
export class JiraClient extends Context.Service<
  JiraClient,
  {
    readonly request: (input: JiraRequest) => Effect.Effect<unknown, BacklogProviderFailed>
    readonly credentialSource: (connection: ProviderConnection) => Effect.Effect<'reference' | 'environment', BacklogProviderFailed>
    readonly siteOf: (connection: ProviderConnection) => Effect.Effect<string, BacklogProviderFailed>
  }
>()('@dshfiles/backlog-jira/JiraClient') {
  static readonly label = LABEL
  static readonly tokenVariables = TOKEN_VARIABLES
  static readonly emailVariable = EMAIL_VARIABLE

  static readonly make = (options: JiraClientOptions = {}) =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const secrets = yield* SecretReferenceResolver
      const minInterval = options.minIntervalMs ?? MIN_INTERVAL_MS
      const nextSlot = yield* Ref.make(new Map<string, number>())

      const credentialOf = Effect.fnUntraced(function* (connection: ProviderConnection) {
        const reference = connection.credential.trim()
        const environment = TOKEN_VARIABLES.map(name => ({ name, value: process.env[name] ?? '' })).find(variable => variable.value !== '')
        const resolved = yield* secrets
          .resolveWithLabel({
            referenceText: reference,
            environmentValue: environment?.value,
            environmentVariableName: environment?.name ?? TOKEN_VARIABLES[0],
          })
          .pipe(Effect.catch(cause => Effect.fail(failed('credential-missing', 'the Secret Catalog could not resolve the reference', undefined, cause))))
        if (Option.isNone(resolved))
          return yield* failed('credential-missing', `no API token is bound and ${TOKEN_VARIABLES.join(' or ')} is not set on the Host`)
        const email = (connection.options?.['email'] ?? '').trim() || (process.env[EMAIL_VARIABLE] ?? '').trim()
        if (email === '')
          return yield* failed('credential-missing', `the connection has no account email; set it in the connection, or ${EMAIL_VARIABLE} on the Host`)
        return {
          authorization: Redacted.make(`Basic ${Buffer.from(`${email}:${resolved.value.value}`).toString('base64')}`),
          source: reference === '' ? ('environment' as const) : ('reference' as const),
        }
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

      const request = (input: JiraRequest) =>
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({
            'dshx.plugin.package': '@dshfiles/backlog-jira',
            'dshx.backlog.sync.provider': 'jira',
            'jira.operation': input.operation,
            'http.request.method': input.method,
          })
          const site = yield* siteOf(input.connection)
          const credential = yield* credentialOf(input.connection)
          const base = HttpClientRequest.make(input.method)(`${site}/rest/api/3${input.path}`).pipe(
            HttpClientRequest.setUrlParams(input.query ?? {}),
            HttpClientRequest.setHeaders({ authorization: Redacted.value(credential.authorization), accept: 'application/json' }),
          )
          const httpRequest = input.body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, input.body)
          for (let attempt = 0; ; attempt += 1) {
            yield* throttle(input.connection.instanceId)
            const response = yield* http.execute(httpRequest).pipe(
              Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(failed('transport', 'timed out')) }),
              Effect.catchTag('HttpClientError', cause => Effect.fail(failed('transport', '', undefined, cause))),
            )
            const json = response.status === 204 ? null : yield* response.json.pipe(Effect.orElseSucceed(() => null))
            if (response.status === 429 || response.status === 503) {
              yield* Effect.annotateCurrentSpan({ 'jira.retries': attempt + 1, 'http.response.status_code': response.status })
              if (attempt >= MAX_RETRIES) return yield* failed('rejected', 'still rate-limited after retrying', 429)
              yield* throttle(input.connection.instanceId, Duration.toMillis(retryDelay(response.headers['retry-after'], attempt)))
              continue
            }
            yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
            if (response.status >= 200 && response.status < 300) return json
            yield* Effect.annotateCurrentSpan('error.type', String(response.status))
            if (response.status === 401 || response.status === 403)
              return yield* failed('rejected', 'Jira refused the account email and API token, or they cannot reach this project', response.status)
            if (response.status === 404)
              return yield* failed('not-found', `${input.reference ?? ''} — check the key and that the account can browse its project`.trim())
            const body = Option.getOrUndefined(Schema.decodeUnknownOption(errorBodySchema)(json))
            const message = [...(body?.errorMessages ?? []), ...Object.entries(body?.errors ?? {}).map(([field, text]) => `${field}: ${text}`)].join('; ')
            if (response.status >= 500) return yield* failed('transport', message, response.status)
            return yield* failed('rejected', message, response.status)
          }
        }).pipe(Effect.withSpan('jira request', { kind: 'client' }))

      return JiraClient.of({
        request,
        credentialSource: connection => Effect.map(credentialOf(connection), credential => credential.source),
        siteOf,
      })
    })

  static readonly layer = (options: JiraClientOptions = {}) => Layer.effect(JiraClient, JiraClient.make(options))
}
