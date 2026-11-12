/**
 * One push delivery and the choice of what to push (productivity pass T6.5). Pure apart from the one `fetch` per
 * device, which runs in a `web-push send` span (push service host and status only, never the endpoint or payload).
 */
import { withSpan } from '@dshfiles/dshx/tracing'
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

const send = (input: {
  readonly subscription: PushSubscriptionKeys
  readonly keys: VapidKeys
  readonly payload: PushPayload
  readonly subject: string
  readonly nowSeconds: number
  readonly fetch?: typeof fetch
}): Promise<PushOutcome> => {
  const service = new URL(input.subscription.endpoint).host
  return withSpan('web-push send', { attributes: { 'server.address': service } }, async span => {
    const body = WebPushCrypto.encrypt(input.subscription, Buffer.from(JSON.stringify(input.payload)))
    try {
      const response = await (input.fetch ?? fetch)(input.subscription.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          TTL: '86400',
          Urgency: 'high',
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          Authorization: WebPushCrypto.vapidAuthorization({
            endpoint: input.subscription.endpoint,
            keys: input.keys,
            subject: input.subject,
            nowSeconds: input.nowSeconds,
          }),
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(15_000),
      })
      span.setAttribute('http.response.status_code', response.status)
      if (response.ok) return { kind: 'sent' }
      if (response.status === 404 || response.status === 410) return { kind: 'gone' }
      return { kind: 'failed', message: failureMessage(response.status) }
    } catch (error) {
      span.setAttribute('error.type', error instanceof Error ? error.name : 'unknown')
      return { kind: 'failed', message: `The push service at ${service} could not be reached from the Host; later items will try again.` }
    }
  })
}

export class WebPushSend {
  static readonly alerts = alerts
  static readonly occurrenceKey = occurrenceKey
  static readonly fresh = fresh
  static readonly payloadOf = payloadOf
  static readonly send = send
}
