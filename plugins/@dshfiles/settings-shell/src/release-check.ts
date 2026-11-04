import { Context, Duration, Effect, Layer, Schema, Stream } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { InstalledVersions } from './installed-versions.js'
import { githubReleasesJson, RELEASES_URL, releaseStatusFromGitHub, RESPONSE_LIMIT_BYTES, type DshReleaseStatus } from './release-status.js'

const RELEASE_CACHE = Duration.hours(1)
const REQUEST_TIMEOUT = Duration.seconds(10)

/** GitHub Releases could not be read: the request failed, timed out, answered an error, or sent too much or malformed data. */
export class ReleaseCheckFailed extends Schema.TaggedError<ReleaseCheckFailed>()(
  'ReleaseCheckFailed',
  {
    reason: Schema.Literals(['request', 'status', 'too-large', 'malformed']),
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'release-check-failed' },
) {
  override get message(): string {
    if (this.reason === 'status') return `GitHub Releases returned HTTP ${String(this.status)}. Retry later.`
    if (this.reason === 'too-large') return 'GitHub Releases response exceeded the size limit. Retry later.'
    if (this.reason === 'malformed') return 'GitHub Releases returned an unexpected payload. Retry later.'
    return 'GitHub Releases could not be reached. Check the network connection, then retry.'
  }
}

const releasesRequest = HttpClientRequest.get(RELEASES_URL).pipe(
  HttpClientRequest.setHeaders({ accept: 'application/vnd.github+json', 'user-agent': 'dshfiles-settings-shell' }),
)

/** Whether a newer DSH release than the installed one exists, checked against GitHub at most once an hour. */
export class ReleaseCheck extends Context.Service<ReleaseCheck, { readonly status: Effect.Effect<DshReleaseStatus, ReleaseCheckFailed> }>()(
  '@dshfiles/settings-shell/ReleaseCheck',
) {
  static readonly layer = Layer.effect(
    ReleaseCheck,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const versions = yield* InstalledVersions

      const check = Effect.gen(function* () {
        const decoder = new TextDecoder()
        const response = yield* client.execute(releasesRequest).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.mapError(cause => new ReleaseCheckFailed({ reason: 'request', cause })),
        )
        if (response.status < 200 || response.status >= 300) return yield* new ReleaseCheckFailed({ reason: 'status', status: response.status })
        const text = yield* response.stream.pipe(
          Stream.mapError(cause => new ReleaseCheckFailed({ reason: 'request', cause })),
          Stream.runFoldEffect(
            () => ({ size: 0, text: '' }),
            (read, chunk) =>
              read.size + chunk.byteLength > RESPONSE_LIMIT_BYTES
                ? Effect.fail(new ReleaseCheckFailed({ reason: 'too-large' }))
                : Effect.succeed({ size: read.size + chunk.byteLength, text: read.text + decoder.decode(chunk, { stream: true }) }),
          ),
          Effect.map(read => read.text + decoder.decode()),
        )
        const releases = yield* Schema.decodeUnknownEffect(githubReleasesJson)(text).pipe(
          Effect.mapError(cause => new ReleaseCheckFailed({ reason: 'malformed', cause })),
        )
        const status = releaseStatusFromGitHub({ currentVersion: versions.dsh, releases })
        yield* Effect.annotateCurrentSpan({ 'dshx.settings-shell.available': status.available, 'dshx.settings-shell.releases': status.releases.length })
        return status
      }).pipe(Effect.withSpan('dsh release check', { kind: 'client', attributes: { 'server.address': 'api.github.com' } }))

      const status = yield* Effect.cachedWithTTL(check, exit => (exit._tag === 'Success' ? RELEASE_CACHE : Duration.zero))
      return ReleaseCheck.of({ status })
    }),
  )
}
