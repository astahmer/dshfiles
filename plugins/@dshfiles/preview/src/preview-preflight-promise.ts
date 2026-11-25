/**
 * The DSH Host's answer to "can the Browser tab show this page?".
 *
 * A cross-origin iframe cannot read its own document, so a framing refusal and a dead port look identical to the
 * pane. The Host can see both, and this service turns them into one bounded probe: one request per URL, headers only
 * (the body is cancelled), a short timeout, and no credentials, cookies or caching. Callers fall back to a browser tab
 * instead of opening a pane that would only ever show Chrome's dead grey page.
 */
import { Context, Duration, Effect, Layer } from 'effect'
import { classifyFraming, normalizeProbeUrl, type EmbedCheck } from './embed-policy.js'

/** Bounds one Host-side check; a dev server that does not answer in time is not running. */
const PREFLIGHT_TIMEOUT = Duration.seconds(5)

/** Named so a target's own logs can tell the pane's check from a browser's page load. */
const PREFLIGHT_USER_AGENT = 'DSH preview preflight (+https://github.com/astahmer/dshfiles)'

const timeoutSignal = (): AbortSignal => AbortSignal.timeout(Duration.toMillis(PREFLIGHT_TIMEOUT))

/**
 * Ask one address whether it answers and whether it may be framed.
 * @param raw - an http(s) address, or a bare `host:port` read as http.
 * @returns reachability, the status, and the framing verdict; never fails, so callers keep opening when unsure.
 */
const probeUrl = (raw: string): Effect.Effect<EmbedCheck> =>
  Effect.gen(function* () {
    const url = normalizeProbeUrl(raw)
    if (url === undefined) return { url: raw, reachable: false, status: null, framing: 'allowed', detail: 'Not an http(s) address.' } satisfies EmbedCheck
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'user-agent': PREFLIGHT_USER_AGENT },
        signal: timeoutSignal(),
      }),
      catch: error => error,
    }).pipe(Effect.option)
    if (response._tag === 'None') {
      // A refused connection, DNS failure or timeout: nothing answered there.
      return { url, reachable: false, status: null, framing: 'allowed', detail: null } satisfies EmbedCheck
    }
    const answer = response.value
    // The document is never needed: the headers decide, and a dev server may stream forever.
    yield* Effect.tryPromise(() => answer.body?.cancel() ?? Promise.resolve()).pipe(Effect.ignore)
    const framing = classifyFraming({
      xFrameOptions: answer.headers.get('x-frame-options'),
      contentSecurityPolicy: answer.headers.get('content-security-policy'),
    })
    const final = normalizeProbeUrl(answer.url) ?? url
    return { url: final, reachable: true, status: answer.status, framing: framing.framing, detail: framing.detail } satisfies EmbedCheck
  })

/** One cached Host probe per URL, and the client-facing check the Browser tab's openers read. */
export class PreviewPreflight extends Context.Service<
  PreviewPreflight,
  {
    readonly probe: (input: { readonly url: string }) => Effect.Effect<EmbedCheck>
  }
>()('@dshfiles/preview/PreviewPreflight') {
  static readonly layer = Layer.effect(
    PreviewPreflight,
    Effect.gen(function* () {
      return PreviewPreflight.of({
        probe: input =>
          probeUrl(input.url).pipe(
            Effect.withSpan('preview preflight', {
              kind: 'client',
              attributes: {
                'http.request.method': 'GET',
                'url.scheme': URL.canParse(input.url) ? new URL(input.url).protocol.replace(':', '') : 'unknown',
              },
            }),
          ),
      })
    }),
  )
}
