/**
 * Push for blocking Inbox items (productivity pass T6.5): each device that turns it on in the Inbox subscribes with
 * the Host's VAPID key, and the Host pushes a Needs you or Failed item to every subscribed device once, through the
 * browser's push service. Ready items never push. The service worker is served from the Host origin
 * (`WEB_PUSH_WORKER_PATH`); on an iPhone, push needs DSH added to the Home Screen (iOS 16.4+).
 */
import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

/** The service worker script, served by the Host on its own origin, outside the authenticated API (it holds no data). */
export const WEB_PUSH_WORKER_PATH = '/dshfiles-web-push/sw.js'
/** The worker's scope: its own folder, so it controls no DSH page; push and notification clicks need no control. */
export const WEB_PUSH_WORKER_SCOPE = '/dshfiles-web-push/'

const deviceSchema = Schema.Struct({
  id: Schema.String,
  /** What the user calls it ("iPhone", the browser's name), from the device that subscribed. */
  label: Schema.String,
  /** The push service's host (web.push.apple.com, fcm.googleapis.com…), never the full endpoint. */
  service: Schema.String,
  createdAt: Schema.Number,
  lastPushAt: Schema.NullOr(Schema.Number),
  /** The last delivery failure, with what to do about it; null after a delivery succeeds. */
  lastError: Schema.NullOr(Schema.String),
})
export type WebPushDevice = typeof deviceSchema.Type

const statusSchema = Schema.Struct({
  /** The Host's VAPID public key (base64url): the browser's `applicationServerKey`. */
  publicKey: Schema.String,
  devices: Schema.Array(deviceSchema),
})
export type WebPushStatus = typeof statusSchema.Type

const subscriptionSchema = Schema.Struct({
  endpoint: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(2000)),
  p256dh: Schema.String.check(Schema.isMinLength(80), Schema.isMaxLength(120)),
  auth: Schema.String.check(Schema.isMinLength(16), Schema.isMaxLength(64)),
})

const renderStatus = (status: WebPushStatus): string =>
  status.devices.length === 0
    ? 'No device receives push. A device turns it on in Inbox › Push to this device (an iPhone needs DSH on its Home Screen, iOS 16.4+).'
    : status.devices
        .map(device => `${device.id} · ${device.label} · ${device.service}${device.lastError === null ? '' : ` · last error: ${device.lastError}`}`)
        .join('\n')

export const webPushApi = defineApi({
  id: 'activity-timeline-web-push',
  version: 1,
  owner: '@dshfiles/activity-timeline',
  methods: {
    status: method({
      input: Schema.Struct({}),
      output: statusSchema,
      description: 'Which devices receive push for blocking Inbox items (Needs you and Failed): label, push service, last push and last error. Read-only.',
      tool: { name: 'inbox_push_devices', readOnly: true, render: renderStatus },
    }),
    subscribe: method({
      input: Schema.Struct({ subscription: subscriptionSchema, label: Schema.String.check(Schema.isMaxLength(80)) }),
      output: deviceSchema,
      description: 'Register this browser push subscription for blocking Inbox items. A device subscribes itself from the Inbox; no agent tool can.',
    }),
    unsubscribe: method({
      input: Schema.Struct({ endpoint: Schema.String }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description: 'Stop pushing to the browser subscription with this endpoint (the device turned push off).',
    }),
    remove: method({
      input: Schema.Struct({
        id: Schema.String,
        confirm: Schema.Literal(true).annotate({ description: 'Must be true: the device stops receiving push until it turns push on again.' }),
      }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description:
        'Stop pushing to one device by id (from inbox_push_devices). Call only when the user asked to remove that device; it can turn push on again from its Inbox.',
      tool: { name: 'inbox_push_remove', readOnly: false },
    }),
    test: method({
      input: Schema.Struct({ id: Schema.optional(Schema.String) }),
      output: Schema.Struct({ sent: Schema.Number, failed: Schema.Number, errors: Schema.Array(Schema.String) }),
      description: 'Send one test notification to every subscribed device, or to one by id. Call only when the user asked for a test push.',
      tool: { name: 'inbox_push_test', readOnly: false },
    }),
  },
})
