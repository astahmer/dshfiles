import { BacklogProviderFailed, type ProviderConnection } from '@dshfiles/backlog/backlog-provider'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

const LABEL = 'Gitea'
const TOKEN_VARIABLES = ['GITEA_TOKEN', 'FORGEJO_TOKEN'] as const
const TIMEOUT = '20 seconds'
const MAX_RETRIES = 3
const MAX_RETRY_AFTER_SECONDS = 60

const errorBodySchema = Schema.Struct({ message: Schema.optionalKey(Schema.NullOr(Schema.String)) })

export interface GiteaRequest {
  readonly connection: ProviderConnection
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** The path under `/api/v1`, owner, repository and number already validated into it. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: object
  /** A short operation name for the span: `list-issues`, `update-issue`… */
  readonly operation: string
  /** What a 404 names, for the recovery message. */
  readonly reference?: string
}

export interface GiteaSite {
  /** The web root issues and repositories live under: `https://git.example.com` (or a sub-path install). */
  readonly web: string
  /** The REST root: `<web>/api/v1`. */
  readonly api: string
  /** The site's host name, lower case: a URL reference must name it. */
  readonly host: string
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

const privateIpv4 = (host: string): boolean => {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0] = parts
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

const PRIVATE_SUFFIXES = ['.internal', '.local', '.lan', '.home.arpa', '.ts.net', '.localhost'] as const

/**
 * Whether a host is private enough for plain http: loopback, an RFC 1918 or CGNAT (Tailscale) address, or a name under
 * a private suffix (`.internal`, `.local`, `.lan`, `.home.arpa`, `.ts.net`). A public host must use https so the token
 * never crosses the internet in clear.
 */
const isPrivateHost = (host: string): boolean => {
  const name = host.toLowerCase().replace(/^\[|\]$/gu, '')
  if (name === 'localhost' || name === '::1') return true
  if (privateIpv4(name)) return true
  return PRIVATE_SUFFIXES.some(suffix => name.endsWith(suffix))
}

/**
 * The instance's web and REST roots from the connection's instance URL; `/api/v1` is accepted and stripped, and a bare
 * host (`gitea.example.com`) reads as https.
 */
const siteOf = (connection: ProviderConnection): Effect.Effect<GiteaSite, BacklogProviderFailed> => {
  const typed = connection.baseUrl.trim()
  if (typed === '') return Effect.fail(failed('target-missing', "set the connection's instance URL, such as https://gitea.example.com"))
  const raw = /^[a-z][a-z0-9+.-]*:\/\//iu.test(typed) ? typed : `https://${typed}`
  if (!URL.canParse(raw)) return Effect.fail(failed('target-missing', 'the instance URL is not a URL; use https://gitea.example.com'))
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return Effect.fail(failed('target-missing', 'the instance URL must be an http(s) URL'))
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname))
    return Effect.fail(
      failed('target-missing', 'the instance URL must use https so the token is never sent in clear (plain http is accepted only for private hosts)'),
    )
  const path = url.pathname.replace(/\/+$/u, '').replace(/\/api\/v1$/u, '')
  const web = `${url.origin}${path}`
  return Effect.succeed({ web, api: `${web}/api/v1`, host: url.hostname.toLowerCase() })
}

/**
 * The Gitea / Forgejo REST v1 client: `Authorization: token …` with the connection's access token resolved on the Host
 * (`secret:ALIAS`, then `GITEA_TOKEN` or `FORGEJO_TOKEN`), and `Retry-After` honored on 429 and 503. One
 * `gitea request` span per HTTP call carries the operation, method, status and retries — never a URL, host or token.
 */
export class GiteaClient extends Context.Service<
  GiteaClient,
  {
    readonly request: (input: GiteaRequest) => Effect.Effect<unknown, BacklogProviderFailed>
    readonly credentialSource: (connection: ProviderConnection) => Effect.Effect<'reference' | 'environment', BacklogProviderFailed>
    readonly siteOf: (connection: ProviderConnection) => Effect.Effect<GiteaSite, BacklogProviderFailed>
  }
>()('@dshfiles/backlog-gitea/GiteaClient') {
  static readonly label = LABEL
  static readonly tokenVariables = TOKEN_VARIABLES
  static readonly isPrivateHost = isPrivateHost

  static readonly make = Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const secrets = yield* SecretReferenceResolver

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
        return yield* failed('credential-missing', `no access token is bound and ${TOKEN_VARIABLES.join(' or ')} is not set on the Host`)
      return {
        authorization: Redacted.make(`token ${resolved.value.value}`),
        source: reference === '' ? ('environment' as const) : ('reference' as const),
      }
    })

    const request = (input: GiteaRequest) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'dshx.plugin.package': '@dshfiles/backlog-gitea',
          'dshx.backlog.sync.provider': 'gitea',
          'gitea.operation': input.operation,
          'http.request.method': input.method,
        })
        const site = yield* siteOf(input.connection)
        const credential = yield* credentialOf(input.connection)
        const base = HttpClientRequest.make(input.method)(`${site.api}${input.path}`).pipe(
          HttpClientRequest.setUrlParams(input.query ?? {}),
          HttpClientRequest.setHeaders({ authorization: Redacted.value(credential.authorization), accept: 'application/json' }),
        )
        const httpRequest = input.body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, input.body)
        for (let attempt = 0; ; attempt += 1) {
          const response = yield* http.execute(httpRequest).pipe(
            Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(failed('transport', 'timed out')) }),
            Effect.catchTag('HttpClientError', cause => Effect.fail(failed('transport', '', undefined, cause))),
          )
          const json = response.status === 204 ? null : yield* response.json.pipe(Effect.orElseSucceed(() => null))
          if (response.status === 429 || response.status === 503) {
            yield* Effect.annotateCurrentSpan({ 'gitea.retries': attempt + 1, 'http.response.status_code': response.status })
            if (attempt >= MAX_RETRIES) return yield* failed('rejected', 'still rate-limited after retrying', 429)
            yield* Effect.sleep(retryDelay(response.headers['retry-after'], attempt))
            continue
          }
          yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
          if (response.status >= 200 && response.status < 300) return json
          yield* Effect.annotateCurrentSpan('error.type', String(response.status))
          const message = Option.match(Schema.decodeUnknownOption(errorBodySchema)(json), { onNone: () => '', onSome: body => body.message ?? '' })
          if (response.status === 401 || response.status === 403)
            return yield* failed(
              'rejected',
              `Gitea refused the access token${message === '' ? '' : `: ${message}`} — it needs the write:issue and write:repository scopes and access to this repository`,
              response.status,
            )
          if (response.status === 404)
            return yield* failed('not-found', `${input.reference ?? ''} — check the repository and number, and that the token can read it`.trim())
          if (response.status >= 500) return yield* failed('transport', message, response.status)
          return yield* failed('rejected', message, response.status)
        }
      }).pipe(Effect.withSpan('gitea request', { kind: 'client' }))

    return GiteaClient.of({
      request,
      credentialSource: connection => Effect.map(credentialOf(connection), credential => credential.source),
      siteOf,
    })
  })

  static readonly layer = Layer.effect(GiteaClient, GiteaClient.make)
}
