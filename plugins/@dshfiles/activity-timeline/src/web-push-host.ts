/**
 * Inbox push on the Host (productivity pass T6.5): the VAPID keys and each device's subscription in the
 * `dshfiles_web_push` storage domain, the service worker served from the Host origin, and one push per new Needs you or
 * Failed item to every device. Plugin-owned end to end: no native verb is involved, and nothing is pushed while no
 * device subscribed.
 */
import { randomUUID } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, hostService, WebRoutes } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Clock, Context, Effect, Layer, Option, Schema, Stream, SynchronizedRef } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { AttentionInbox } from './attention-store.js'
import { WebPushCrypto, type VapidKeys } from './web-push-crypto.js'
import { webPushApi, WEB_PUSH_WORKER_PATH, type WebPushDevice, type WebPushStatus } from './web-push-api.js'
import { WebPushSend, type PushPayload } from './web-push-send.js'
import { WEB_PUSH_WORKER_SOURCE } from './web-push-worker.js'

const keysSchema = Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String })
const deviceRecordSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  endpoint: Schema.String,
  p256dh: Schema.String,
  auth: Schema.String,
  createdAt: Schema.Number,
  lastPushAt: Schema.NullOr(Schema.Number),
  lastError: Schema.NullOr(Schema.String),
})
type DeviceRecord = typeof deviceRecordSchema.Type

export const webPushDomain = defineDomain({
  name: 'dshfiles_web_push',
  version: 1,
  layout: 'per-record',
  tables: {
    keys: { valueSchema: zodSchemaFromEffect(keysSchema), __key: 'keys' },
    devices: { valueSchema: zodSchemaFromEffect(deviceRecordSchema), __key: 'devices' },
  },
})

export class WebPushStorageFailed extends Schema.TaggedError<WebPushStorageFailed>()(
  'WebPushStorageFailed',
  { operation: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'web-push-storage-failed' },
) {
  override get message(): string {
    return `Inbox push could not ${this.operation} its storage. Retry; if it keeps failing, check the DSH Host log for the storage error.`
  }
}

/** The VAPID `sub` claim: a contact the push services accept; no personal address is sent. */
const VAPID_SUBJECT = 'mailto:dsh-inbox@localhost'
const VAPID_KEY_ID = 'vapid'

const publicDevice = (device: DeviceRecord): WebPushDevice => ({
  id: device.id,
  label: device.label,
  service: new URL(device.endpoint).host,
  createdAt: device.createdAt,
  lastPushAt: device.lastPushAt,
  lastError: device.lastError,
})

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const storageFailed = (operation: string) => (cause: unknown) => new WebPushStorageFailed({ operation, cause })
  const domain = yield* (yield* StorageDomain).open(webPushDomain).pipe(Effect.mapError(storageFailed('open')))
  const keysTable = domain.table('keys')
  const devicesTable = domain.table('devices')
  const storedKeys = yield* keysTable.entries.pipe(Effect.mapError(storageFailed('read')))
  const keys: VapidKeys =
    storedKeys.find(([id]) => id === VAPID_KEY_ID)?.[1] ??
    (yield* Effect.gen(function* () {
      const generated = WebPushCrypto.generateVapidKeys()
      yield* keysTable.put(VAPID_KEY_ID, generated).pipe(Effect.mapError(storageFailed('write')))
      return generated
    }))
  const devices = yield* SynchronizedRef.make<ReadonlyMap<string, DeviceRecord>>(
    new Map((yield* devicesTable.entries.pipe(Effect.mapError(storageFailed('read')))).map(([id, record]) => [id, record])),
  )

  const putDevice = (record: DeviceRecord) => devicesTable.put(record.id, record).pipe(Effect.mapError(storageFailed('write')))
  const dropDevice = (id: string) =>
    SynchronizedRef.modifyEffect(devices, current =>
      current.has(id)
        ? devicesTable.delete(id).pipe(Effect.mapError(storageFailed('write')), Effect.as([true, new Map([...current].filter(([key]) => key !== id))] as const))
        : Effect.succeed([false, current] as const),
    )

  const status = Effect.map(SynchronizedRef.get(devices), (current): WebPushStatus => ({
    publicKey: keys.publicKey,
    devices: [...current.values()].sort((a, b) => a.createdAt - b.createdAt).map(publicDevice),
  }))

  /** Deliver one payload to some devices; a forgotten subscription is dropped, a failure is kept on the device. */
  const deliver = (targets: readonly DeviceRecord[], payload: PushPayload) =>
    Effect.forEach(
      targets,
      device =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const outcome = yield* WebPushSend.send({ subscription: device, keys, payload, subject: VAPID_SUBJECT, nowSeconds: Math.floor(now / 1000) }).pipe(
            Effect.provideService(HttpClient.HttpClient, client),
          )
          if (outcome.kind === 'gone') {
            yield* dropDevice(device.id)
            return { id: device.id, error: `${device.label}: its push subscription expired; it was removed. Turn push on again on that device.` }
          }
          const next: DeviceRecord = { ...device, ...(outcome.kind === 'sent' ? { lastPushAt: now, lastError: null } : { lastError: outcome.message }) }
          yield* SynchronizedRef.update(devices, current => (current.has(device.id) ? new Map(current).set(device.id, next) : current))
          yield* putDevice(next)
          return { id: device.id, error: outcome.kind === 'sent' ? null : `${device.label}: ${outcome.message}` }
        }),
      { concurrency: 4 },
    )

  // Each new Needs you or Failed item goes to every device once; the first read only seeds what is already open.
  const inbox = yield* AttentionInbox
  const pushed = yield* SynchronizedRef.make<ReadonlySet<string> | null>(null)
  const pushNew = Effect.gen(function* () {
    const list = yield* inbox.list({ view: 'needs-you', limit: 200 })
    const fresh = yield* SynchronizedRef.modify(
      pushed,
      known => [WebPushSend.fresh(known, list.items), new Set(list.items.filter(WebPushSend.alerts).map(WebPushSend.occurrenceKey))] as const,
    )
    const targets = [...(yield* SynchronizedRef.get(devices)).values()]
    if (fresh.length === 0 || targets.length === 0) return
    yield* Effect.forEach(fresh, item => deliver(targets, WebPushSend.payloadOf(item)), { discard: true })
  })
  yield* pushNew.pipe(Effect.catchCause(cause => Effect.logWarning('activity-timeline: inbox push seed failed', cause)))
  yield* inbox.changes.pipe(
    Stream.runForEach(() => pushNew.pipe(Effect.catchCause(cause => Effect.logWarning('activity-timeline: inbox push failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )

  // The worker script, on the Host origin outside the authenticated API: it is static and holds no data.
  const webServer = yield* hostService('webServer').pipe(Effect.option)
  if (Option.isSome(webServer)) {
    const server = webServer.value
    yield* WebRoutes.register(server, {
      kind: 'exact',
      path: WEB_PUSH_WORKER_PATH,
      handler: (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD' })
          response.end()
          return
        }
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
        response.end(request.method === 'HEAD' ? undefined : WEB_PUSH_WORKER_SOURCE)
      },
    })
  }

  return WebPush.of({
    status,
    subscribe: input =>
      SynchronizedRef.modifyEffect(devices, current =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const existing = [...current.values()].find(device => device.endpoint === input.subscription.endpoint)
          const record: DeviceRecord = {
            id: existing?.id ?? randomUUID(),
            label: input.label.trim() === '' ? 'This device' : input.label.trim(),
            endpoint: input.subscription.endpoint,
            p256dh: input.subscription.p256dh,
            auth: input.subscription.auth,
            createdAt: existing?.createdAt ?? now,
            lastPushAt: existing?.lastPushAt ?? null,
            lastError: null,
          }
          yield* putDevice(record)
          return [publicDevice(record), new Map(current).set(record.id, record)] as const
        }),
      ),
    unsubscribe: endpoint =>
      Effect.flatMap(SynchronizedRef.get(devices), current => {
        const device = [...current.values()].find(candidate => candidate.endpoint === endpoint)
        return device === undefined ? Effect.succeed(false) : dropDevice(device.id)
      }),
    remove: dropDevice,
    test: id =>
      Effect.gen(function* () {
        const current = [...(yield* SynchronizedRef.get(devices)).values()].filter(device => id === undefined || device.id === id)
        const results = yield* deliver(current, {
          title: 'DSH',
          body: 'Test push: blocking Inbox items will arrive like this.',
          tag: 'dshfiles-web-push-test',
          path: '',
        })
        const errors = results.flatMap(result => (result.error === null ? [] : [result.error]))
        return { sent: results.length - errors.length, failed: errors.length, errors }
      }),
  })
})

export class WebPush extends Context.Service<
  WebPush,
  {
    readonly status: Effect.Effect<WebPushStatus>
    readonly subscribe: (input: {
      readonly subscription: { readonly endpoint: string; readonly p256dh: string; readonly auth: string }
      readonly label: string
    }) => Effect.Effect<WebPushDevice, WebPushStorageFailed>
    readonly unsubscribe: (endpoint: string) => Effect.Effect<boolean, WebPushStorageFailed>
    readonly remove: (id: string) => Effect.Effect<boolean, WebPushStorageFailed>
    readonly test: (
      id: string | undefined,
    ) => Effect.Effect<{ readonly sent: number; readonly failed: number; readonly errors: readonly string[] }, WebPushStorageFailed>
  }
>()('@dshfiles/activity-timeline/WebPush') {
  /** Pushes go out through the fetch HTTP client. */
  static readonly layer = Layer.effect(WebPush, make).pipe(Layer.provide(FetchHttpClient.layer))
}

export const webPushHandlers = Api.handlers(webPushApi, {
  status: () => WebPush.use(push => push.status),
  subscribe: input => WebPush.use(push => push.subscribe(input)),
  unsubscribe: input => WebPush.use(push => Effect.map(push.unsubscribe(input.endpoint), removed => ({ removed }))),
  remove: input => WebPush.use(push => Effect.map(push.remove(input.id), removed => ({ removed }))),
  test: input => WebPush.use(push => push.test(input.id)),
})
