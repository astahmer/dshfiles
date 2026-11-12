/**
 * One push delivery and the choice of what to push (productivity pass T6.5). Pure apart from the one push request
 * per device, which runs in a `web-push send` span (push service host and status only, never the endpoint or payload).
 */
import { Effect } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import type { AttentionItem } from './attention-api.js'
import { WebPushCrypto, type PushSubscriptionKeys, type VapidKeys } from './web-push-crypto.js'

export interface PushPayload {
  readonly title: string
  readonly body: string
  readonly tag: string
  /** Where a click goes, relative to the DSH root: the item's thread, or the root (the Inbox opens from there). */
  readonly path: string
}

export type PushOutcome =
  | { readonly kind: 'sent' }
  /** The push service forgot this subscription (404/410): drop the device. */
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed'; readonly message: string }

const BODY_LIMIT = 240
const shorten = (text: string): string => (text.length <= BODY_LIMIT ? text : `${text.slice(0, BODY_LIMIT - 1)}…`)

/** Needs you items worth interrupting for, as in the tab: a question or approval, and a failure. Ready never pushes. */
const alerts = (item: Pick<AttentionItem, 'severity'>): boolean => item.severity === 'blocking' || item.severity === 'failed'

const occurrenceKey = (item: Pick<AttentionItem, 'id' | 'openedAt'>): string => `${item.id}:${String(item.openedAt)}`

/**
 * The items one list brings that were not pushed yet. `known` null is the Host's first read: it only seeds, so a
 * restart never replays the open items.
 */
const fresh = (known: ReadonlySet<string> | null, items: readonly AttentionItem[]): readonly AttentionItem[] =>
  known === null ? [] : items.filter(item => alerts(item) && !known.has(occurrenceKey(item)))

/** The notification for one item: its subject as title, the question or failure (with its recovery) as body. */
const payloadOf = (item: AttentionItem): PushPayload => {
  const title = item.subject.label ?? (item.severity === 'failed' ? 'Failed' : 'Needs you')
  const recovery = item.severity === 'failed' && item.detail !== null ? item.detail.split('\n')[0]?.trim() : undefined
  return {
    title,
    body: shorten(recovery === undefined || recovery === '' ? item.reason : `${item.reason} ${recovery}`),
    tag: `dshfiles-attention-${item.id}`,
    path: item.subject.kind === 'session' ? `?thread=${encodeURIComponent(item.subject.id)}` : '',
  }
}

/** What a failed delivery says, with what the user can do about it. */
const failureMessage = (status: number): string => {
  if (status === 401 || status === 403) return `The push service refused the Host's key (${String(status)}). Turn push off and on again on that device.`
  if (status === 413) return 'The notification was too large for the push service.'
  if (status === 429) return 'The push service is rate-limiting this Host (429); later items will try again.'
  return `The push service answered ${String(status)}; later items will try again. If it persists, turn push off and on again on that device.`
}

/** The push service's answer as an outcome: accepted, forgotten (drop the device), or refused with what to do. */
const outcomeOf = (status: number): PushOutcome => {
  if (status >= 200 && status < 300) return { kind: 'sent' }
  if (status === 404 || status === 410) return { kind: 'gone' }
  return { kind: 'failed', message: failureMessage(status) }
}

/**
 * Push one payload to one subscription. Never fails: an unreachable service is a `failed` outcome. The HTTP client's
 * own span is off, so neither the endpoint (it holds the subscription's secret) nor the payload reaches a trace.
 */
const send = (input: {
  readonly subscription: PushSubscriptionKeys
  readonly keys: VapidKeys
  readonly payload: PushPayload
  readonly subject: string
  readonly nowSeconds: number
}): Effect.Effect<PushOutcome, never, HttpClient.HttpClient> => {
  const service = new URL(input.subscription.endpoint).host
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const body = WebPushCrypto.encrypt(input.subscription, Buffer.from(JSON.stringify(input.payload)))
    const request = HttpClientRequest.post(input.subscription.endpoint).pipe(
      HttpClientRequest.setHeaders({
        TTL: '86400',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        Authorization: WebPushCrypto.vapidAuthorization({
          endpoint: input.subscription.endpoint,
          keys: input.keys,
          subject: input.subject,
          nowSeconds: input.nowSeconds,
        }),
      }),
      HttpClientRequest.bodyUint8Array(new Uint8Array(body), 'application/octet-stream'),
    )
    return yield* client.execute(request).pipe(
      Effect.timeout('15 seconds'),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.matchEffect({
        onFailure: error =>
          Effect.annotateCurrentSpan('error.type', error._tag).pipe(
            Effect.as<PushOutcome>({
              kind: 'failed',
              message: `The push service at ${service} could not be reached from the Host; later items will try again.`,
            }),
          ),
        onSuccess: response => Effect.annotateCurrentSpan('http.response.status_code', response.status).pipe(Effect.as(outcomeOf(response.status))),
      }),
    )
  }).pipe(Effect.withSpan('web-push send', { attributes: { 'server.address': service } }))
}

export class WebPushSend {
  static readonly alerts = alerts
  static readonly occurrenceKey = occurrenceKey
  static readonly fresh = fresh
  static readonly payloadOf = payloadOf
  static readonly send = send
}
