import { defineApi, method } from '@dshfiles/dshx/api'
import { Effect, Schema } from 'effect'
import { EXPIRY_PRESETS, PASSPHRASE_MAX, PASSPHRASE_MIN } from './share-policy-constants.js'

const ONLY_WHEN_ASKED = 'Call only when the user asked to'

export const shareRowSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(['live', 'snapshot']),
  access: Schema.Literals(['link', 'protected']),
  status: Schema.Literals(['active', 'expired', 'revoked']),
  createdAt: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number),
  revokedAt: Schema.NullOr(Schema.Number),
  views: Schema.Number.check(Schema.isInt()),
  lastViewedAt: Schema.NullOr(Schema.Number),
})
export type ShareRow = typeof shareRowSchema.Type

const linkSchema = Schema.Struct({ label: Schema.String, url: Schema.String })

const toolSchema = Schema.Struct({ available: Schema.Boolean, path: Schema.NullOr(Schema.String) })

export const publishStatusSchema = Schema.Struct({
  tools: Schema.Struct({ tailscale: toolSchema, cloudflared: toolSchema }),
  active: Schema.NullOr(
    Schema.Struct({
      provider: Schema.Literals(['tailscale-funnel', 'cloudflared']),
      state: Schema.Literals(['starting', 'published', 'failed']),
      publicUrl: Schema.NullOr(Schema.String),
      localPort: Schema.Number,
      startedAt: Schema.Number,
      stopsAt: Schema.Number,
      detail: Schema.NullOr(Schema.String),
    }),
  ),
})
export type PublishStatus = typeof publishStatusSchema.Type

export const threadOptionSchema = Schema.Struct({ sessionId: Schema.String, title: Schema.String, updatedAt: Schema.Number })

const sessionId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({ description: 'Thread id (DSH Session id).' })

/**
 * Read-only sharing of one thread. The link token is shown once, in the create answer; the Host keeps only its
 * SHA-256 and, for a protected share, a salted scrypt hash of the passphrase.
 */
export const threadShareApi = defineApi({
  id: 'thread-share',
  version: 1,
  owner: '@dshfiles/thread-share',
  methods: {
    list: method({
      description:
        'List thread shares with their access mode, expiry, status and view count; never the link token or passphrase. Active shares only unless includeInactive is true. Read-only.',
      input: Schema.Struct({ includeInactive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))) }),
      output: Schema.Struct({ shares: Schema.Array(shareRowSchema), routePath: Schema.String }),
      readOnly: true,
      tool: { name: 'thread_share_list', readOnly: true },
    }),
    threads: method({
      description: 'Recent threads a share can be created for, newest first.',
      input: Schema.Record(Schema.String, Schema.Never),
      output: Schema.Struct({ threads: Schema.Array(threadOptionSchema) }),
      readOnly: true,
    }),
    create: method({
      description: `Create a read-only share link for one thread: live (re-read on every view) or snapshot (frozen now), anyone-with-link or protected by a passphrase, expiring after 1h, 1d, 7d or never. Returns the link once; it cannot be shown again. A passphrase given here appears in the transcript; prefer setting it in Settings › Thread sharing. ${ONLY_WHEN_ASKED} share that thread.`,
      input: Schema.Struct({
        sessionId,
        kind: Schema.Literals(['live', 'snapshot']),
        access: Schema.Literals(['link', 'protected']),
        passphrase: Schema.optional(Schema.String.check(Schema.isMinLength(PASSPHRASE_MIN), Schema.isMaxLength(PASSPHRASE_MAX))),
        expiry: Schema.Literals(EXPIRY_PRESETS),
      }).check(
        Schema.makeFilter(input =>
          input.access === 'protected'
            ? input.passphrase !== undefined || `A protected share needs a passphrase of at least ${String(PASSPHRASE_MIN)} characters.`
            : input.passphrase === undefined || 'A passphrase only applies to a protected share; choose access "protected" or drop it.',
        ),
      ),
      output: Schema.Struct({ share: shareRowSchema, path: Schema.String, links: Schema.Array(linkSchema) }),
      tool: { name: 'thread_share_create', readOnly: false },
    }),
    revoke: method({
      description: `Revoke one share by id: its link stops working at once and its snapshot is deleted. Revoking cannot be undone; create a new share instead. ${ONLY_WHEN_ASKED} revoke that share; confirm must be true.`,
      input: Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)), confirm: Schema.Literal(true) }),
      output: Schema.Struct({ share: shareRowSchema }),
      tool: { name: 'thread_share_revoke', readOnly: false },
    }),
    exportHtml: method({
      description:
        "Render one thread's user and assistant messages, redacted, as one self-contained HTML file (no script, no external resource) to host or upload anywhere. Creates no link. Read-only.",
      input: Schema.Struct({ sessionId }),
      output: Schema.Struct({ fileName: Schema.String, html: Schema.String }),
      readOnly: true,
      tool: { name: 'thread_share_export', readOnly: true },
    }),
    publishStatus: method({
      description:
        'Whether tailscale and cloudflared are installed, and the publish tunnel that is running now, if any (provider, public URL, when it stops). Read-only.',
      input: Schema.Record(Schema.String, Schema.Never),
      output: publishStatusSchema,
      readOnly: true,
      tool: { name: 'thread_share_publish_status', readOnly: true },
    }),
    publishStart: method({
      description:
        'Publish only the share route to the internet through a Tailscale Funnel or a cloudflared quick tunnel, for a bounded time. The user starts this in Settings › Thread sharing; agents have no tool for it.',
      input: Schema.Struct({
        provider: Schema.Literals(['tailscale-funnel', 'cloudflared']),
        minutes: Schema.Literals([15, 60, 240]),
        confirm: Schema.Literal(true),
      }),
      output: publishStatusSchema,
    }),
    publishStop: method({
      description: `Stop the running publish tunnel, so shares are reachable only through DSH's own address again. ${ONLY_WHEN_ASKED} stop publishing.`,
      input: Schema.Record(Schema.String, Schema.Never),
      output: publishStatusSchema,
      tool: { name: 'thread_share_publish_stop', readOnly: false },
    }),
  },
})
