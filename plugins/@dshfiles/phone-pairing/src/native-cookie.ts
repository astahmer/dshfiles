import { Clock, Duration, Effect } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'

/** The native listener's authority-bound session cookie the gateway forwards. */
export interface NativeCookie {
  readonly value: string
  readonly expiresAt: number
}

/**
 * Exchange the native launch URL for its session cookie. The redirect is not followed and its body is never read: the
 * request aborts once the headers are in. The launch URL carries the token, so the client records no span of its own.
 */
export const mintNativeCookie = Effect.fn('phone pairing native cookie')(function* (url: string) {
  const client = HttpClient.withScope(yield* HttpClient.HttpClient)
  const response = yield* client.get(url).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  )
  yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
  const cookie = Object.values(response.cookies.cookies)[0]
  if (cookie === undefined || cookie.valueEncoded === '') return undefined
  const now = yield* Clock.currentTimeMillis
  const maxAge = cookie.options?.maxAge
  const minted: NativeCookie = {
    value: `${cookie.name}=${cookie.valueEncoded}`,
    expiresAt: maxAge === undefined ? Number.POSITIVE_INFINITY : now + Duration.toMillis(maxAge),
  }
  return minted
}, Effect.scoped)
