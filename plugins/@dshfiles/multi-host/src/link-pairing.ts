import { Effect, Option, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { LinkPairRefused } from './errors.js'
import { linkTransport } from './connectors/direct.js'

const protocolSchema = Schema.Struct({ protocol: Schema.Literal('dsh-link'), version: Schema.Literal(1) })
const redeemedSchema = Schema.Struct({
  credential: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
  runtimeId: Schema.String.check(Schema.isUUID()),
  name: Schema.String.check(Schema.isMaxLength(255)),
})
const refusalSchema = Schema.Struct({ reason: Schema.String })
const decodeProtocol = Schema.decodeUnknownOption(Schema.fromJsonString(protocolSchema))
const decodeRedeemed = Schema.decodeUnknownOption(Schema.fromJsonString(redeemedSchema))
const decodeRefusal = Schema.decodeUnknownOption(Schema.fromJsonString(refusalSchema))

const isRefusalReason = Schema.is(Schema.Literals(['invalid', 'expired', 'used', 'unknown', 'rate-limited', 'too-many-peers']))

/**
 * Redeem a pairing code at a peer's link gateway: check it speaks the link protocol, then trade the code for a
 * credential. The credential is returned, never logged; the span carries the transport kind only.
 */
export const redeemPairingCode = Effect.fn('multi-host link pair')(function* (input: {
  readonly url: string
  readonly code: string
  readonly name: string
  readonly runtimeId: string
  readonly allowPlainHttp: boolean
}) {
  const transport = linkTransport(input.url)
  yield* Effect.annotateCurrentSpan('multi_host.link.transport', transport)
  if (transport === 'plain' && !input.allowPlainHttp) return yield* new LinkPairRefused({ reason: 'insecure-url' })
  const client = yield* HttpClient.HttpClient
  const unreachable = () => new LinkPairRefused({ reason: 'unreachable' })

  const probe = yield* client.get(`${input.url}/link`).pipe(
    Effect.flatMap(response => response.text),
    Effect.timeout('10 seconds'),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.mapError(unreachable),
  )
  if (Option.isNone(decodeProtocol(probe))) return yield* new LinkPairRefused({ reason: 'protocol' })

  const response = yield* client
    .execute(
      HttpClientRequest.post(`${input.url}/link/redeem`).pipe(
        HttpClientRequest.bodyText(JSON.stringify({ code: input.code, name: input.name, runtimeId: input.runtimeId }), 'application/json'),
      ),
    )
    .pipe(
      Effect.timeout('15 seconds'),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.mapError(unreachable),
    )
  const text = yield* response.text.pipe(Effect.mapError(unreachable))
  if (response.status !== 200) {
    const reason = Option.getOrUndefined(decodeRefusal(text))?.reason
    return yield* new LinkPairRefused({ reason: reason !== undefined && isRefusalReason(reason) ? reason : 'protocol' })
  }
  const redeemed = decodeRedeemed(text)
  if (Option.isNone(redeemed)) return yield* new LinkPairRefused({ reason: 'protocol' })
  return redeemed.value
})
