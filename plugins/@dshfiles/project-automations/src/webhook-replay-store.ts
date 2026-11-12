import { createHash } from 'node:crypto'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { Context, Effect, Layer, Option, Schema, Semaphore } from 'effect'
import { AutomationStorageFailure, NAMESPACE } from './automation-store.js'

/** GitHub's delivery id: unique per delivery, and deliberately reused by a redelivery. Not covered by the signature. */
export const GITHUB_DELIVERY_HEADER = 'x-github-delivery'
/** Remembered deliveries; beyond this the oldest are forgotten before their window ends. */
export const MAX_DELIVERIES = 10_000
/**
 * Remembered body digests. Each lives as long as its delivery id: the id is not signed, so a shorter body window would
 * let a captured request be replayed under a fresh id once it ended.
 */
export const MAX_BODY_DIGESTS = MAX_DELIVERIES
const SWEEP_INTERVAL_MS = 60_000
const DELIVERY_PREFIX = 'webhook-delivery/'
const BODY_PREFIX = 'webhook-body/'

const deliverySchema = Schema.Struct({ digest: Schema.String, receivedAt: Schema.Number, expiresAt: Schema.Number })
const bodySchema = Schema.Struct({ deliveryId: Schema.String, expiresAt: Schema.Number })
const decodeDelivery = Schema.decodeUnknownOption(deliverySchema)
const decodeBody = Schema.decodeUnknownOption(bodySchema)
const encodeDelivery = Schema.encodeSync(Schema.toCodecJson(deliverySchema))
const encodeBody = Schema.encodeSync(Schema.toCodecJson(bodySchema))

/** The delivery id a GitHub webhook must carry: GitHub's GUID, kept opaque and bounded. */
export const isDeliveryId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(value)

/** SHA-256 of the raw request body, hex. One body under two delivery ids is one event resent. */
export const bodyDigestOf = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')

export type ReplayVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: 'replayed-delivery' | 'replayed-body' }

type Delivery = { readonly digest: string; readonly expiresAt: number }

const make = Effect.gen(function* () {
  const storage = yield* PluginStorage
  /** One claim at a time, so two concurrent requests with the same delivery id cannot both pass. */
  const lock = yield* Semaphore.make(1)
  const deliveries = new Map<string, Delivery>()
  const bodies = new Map<string, number>()
  let loaded = false
  let lastSweep = 0
  const failed = (operation: string) => (cause: unknown) => new AutomationStorageFailure({ operation, cause })

  /** Delete expired entries, cheapest first: the maps bound the work, and a failed cleanup never blocks a claim. */
  const sweep = Effect.fn('webhook replay sweep')(function* (now: number) {
    lastSweep = now
    for (const [id, delivery] of deliveries) {
      if (delivery.expiresAt > now) continue
      deliveries.delete(id)
      yield* storage.delete(`${DELIVERY_PREFIX}${id}`).pipe(Effect.ignore)
    }
    for (const [digest, expiresAt] of bodies) {
      if (expiresAt > now) continue
      bodies.delete(digest)
      yield* storage.delete(`${BODY_PREFIX}${digest}`).pipe(Effect.ignore)
    }
  })

  /** Forget the oldest entries when a cap is reached; a replay of a forgotten delivery is no longer detected. */
  const enforceCaps = Effect.fn('webhook replay cap')(function* () {
    while (deliveries.size > MAX_DELIVERIES) {
      const oldest = [...deliveries].reduce((a, b) => (b[1].expiresAt < a[1].expiresAt ? b : a))
      deliveries.delete(oldest[0])
      yield* storage.delete(`${DELIVERY_PREFIX}${oldest[0]}`).pipe(Effect.ignore)
    }
    while (bodies.size > MAX_BODY_DIGESTS) {
      const oldest = [...bodies].reduce((a, b) => (b[1] < a[1] ? b : a))
      bodies.delete(oldest[0])
      yield* storage.delete(`${BODY_PREFIX}${oldest[0]}`).pipe(Effect.ignore)
    }
  })

  /** Read what this Host already remembers, once: a restart must not reset replay protection. */
  const load = Effect.fn('webhook replay load')(function* (now: number) {
    if (loaded) return
    const storedDeliveries = yield* storage.listAll({ prefix: DELIVERY_PREFIX }).pipe(Effect.mapError(failed('list')))
    const storedBodies = yield* storage.listAll({ prefix: BODY_PREFIX }).pipe(Effect.mapError(failed('list')))
    for (const entry of storedDeliveries) {
      const id = entry.key.slice(DELIVERY_PREFIX.length)
      const record = Option.getOrNull(decodeDelivery(entry.value))
      if (record !== null && record.expiresAt > now) deliveries.set(id, { digest: record.digest, expiresAt: record.expiresAt })
      else yield* storage.delete(entry.key).pipe(Effect.ignore)
    }
    for (const entry of storedBodies) {
      const digest = entry.key.slice(BODY_PREFIX.length)
      const record = Option.getOrNull(decodeBody(entry.value))
      if (record !== null && record.expiresAt > now) bodies.set(digest, record.expiresAt)
      else yield* storage.delete(entry.key).pipe(Effect.ignore)
    }
    loaded = true
    lastSweep = now
    yield* enforceCaps()
  })

  /**
   * Claim one GitHub delivery: refuse a delivery id seen inside the window, and a body already accepted under another
   * id. Both writes land before the caller starts a thread, so a crash between them cannot accept the same event twice.
   */
  const claim = Effect.fn('webhook replay claim')(function* (input: {
    readonly deliveryId: string
    readonly digest: string
    readonly now: number
    readonly windowMs: number
  }) {
    yield* load(input.now)
    if (input.now - lastSweep >= SWEEP_INTERVAL_MS) yield* sweep(input.now)
    const seen = deliveries.get(input.deliveryId)
    if (seen !== undefined && seen.expiresAt > input.now) return { ok: false as const, reason: 'replayed-delivery' as const }
    const bodyExpiry = bodies.get(input.digest)
    if (bodyExpiry !== undefined && bodyExpiry > input.now) return { ok: false as const, reason: 'replayed-body' as const }
    const expiresAt = input.now + input.windowMs
    yield* storage
      .set(`${DELIVERY_PREFIX}${input.deliveryId}`, encodeDelivery({ digest: input.digest, receivedAt: input.now, expiresAt }))
      .pipe(Effect.mapError(failed('set')))
    yield* storage.set(`${BODY_PREFIX}${input.digest}`, encodeBody({ deliveryId: input.deliveryId, expiresAt })).pipe(Effect.mapError(failed('set')))
    deliveries.set(input.deliveryId, { digest: input.digest, expiresAt })
    bodies.set(input.digest, expiresAt)
    yield* enforceCaps()
    return { ok: true as const }
  })

  /** Forget a claim whose event started no thread, so GitHub's Redeliver of the same delivery is accepted. */
  const release = Effect.fn('webhook replay release')(function* (input: { readonly deliveryId: string; readonly digest: string }) {
    if (deliveries.get(input.deliveryId)?.digest !== input.digest) return
    deliveries.delete(input.deliveryId)
    bodies.delete(input.digest)
    yield* storage.delete(`${DELIVERY_PREFIX}${input.deliveryId}`).pipe(Effect.mapError(failed('delete')))
    yield* storage.delete(`${BODY_PREFIX}${input.digest}`).pipe(Effect.mapError(failed('delete')))
  })

  return {
    claim: (input: { readonly deliveryId: string; readonly digest: string; readonly now: number; readonly windowMs: number }) =>
      lock.withPermits(1)(claim(input)),
    release: (input: { readonly deliveryId: string; readonly digest: string }) => lock.withPermits(1)(release(input)),
  }
})

/**
 * GitHub deliveries this Host has already accepted, in the plugin's storage namespace so a Host restart keeps them.
 * The timestamped scheme keeps its own in-memory window; this store only answers GitHub's untimestamped signature.
 */
export class WebhookReplayStore extends Context.Service<
  WebhookReplayStore,
  {
    readonly claim: (input: {
      readonly deliveryId: string
      readonly digest: string
      readonly now: number
      readonly windowMs: number
    }) => Effect.Effect<ReplayVerdict, AutomationStorageFailure>
    readonly release: (input: { readonly deliveryId: string; readonly digest: string }) => Effect.Effect<void, AutomationStorageFailure>
  }
>()('@dshfiles/project-automations/WebhookReplayStore') {
  static readonly layerWithoutStorage = Layer.effect(WebhookReplayStore, make)
  static readonly layer = WebhookReplayStore.layerWithoutStorage.pipe(Layer.provide(PluginStorage.layerFor(NAMESPACE)))
}
