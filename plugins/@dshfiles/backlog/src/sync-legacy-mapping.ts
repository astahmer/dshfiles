import { Schema } from 'effect'
import { BacklogItems } from './item.js'

const timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

/** The synced fields as the pre-binding sync kept them; a remote side may not express a status (null). */
const legacySnapshotSchema = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(BacklogItems.maxTitleChars * 2)),
  body: Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars * 4)),
  status: Schema.NullOr(BacklogItems.statusSchema),
  tags: Schema.Array(Schema.String.check(Schema.isMaxLength(60))).check(Schema.isMaxLength(50)),
})

/**
 * How one item was tied to one Linear or GitHub issue before connections and bindings: one mapping per item, named by
 * its tracker only. Kept to decode the JSON storage domain and the `sync_mappings` table, which the migration to
 * external refs reads once (`SyncSourcesMigration`); nothing writes it any more.
 */
const legacyMappingSchema = Schema.Struct({
  itemId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  backend: Schema.Literals(['linear', 'github']),
  remoteId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  remoteKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars)),
  linkedAt: timestamp,
  lastSyncedAt: Schema.NullOr(timestamp),
  remoteUpdatedAt: Schema.NullOr(timestamp),
  localSyncedAt: Schema.NullOr(timestamp),
  base: Schema.NullOr(Schema.Struct({ local: legacySnapshotSchema, remote: legacySnapshotSchema })),
  comments: Schema.Array(Schema.Struct({ local: Schema.String.check(Schema.isMaxLength(128)), remote: Schema.String.check(Schema.isMaxLength(200)) })).check(
    Schema.isMaxLength(400),
  ),
  pushCommentsSince: timestamp,
  state: Schema.Literals(['synced', 'pending', 'conflict', 'error']),
  conflicts: Schema.Array(
    Schema.Struct({
      field: Schema.Literals(['title', 'body', 'status', 'tags']),
      at: timestamp,
      kept: Schema.Literals(['local', 'remote']),
      local: Schema.String.check(Schema.isMaxLength(2_000)),
      remote: Schema.String.check(Schema.isMaxLength(2_000)),
    }),
  ).check(Schema.isMaxLength(20)),
  lastError: Schema.NullOr(
    Schema.Struct({ code: Schema.String.check(Schema.isMaxLength(64)), message: Schema.String.check(Schema.isMaxLength(1_000)), at: timestamp }),
  ),
})

export type SyncMapping = typeof legacyMappingSchema.Type

/** The prefix a comment carried over before origins existed starts with, per legacy tracker. */
const legacyCommentPrefixes = { linear: 'Linear · ', github: 'GitHub · ' } as const

/** The tracker a comment carried over before origins existed came from, read back from its prefix. */
const legacyCommentBackend = (text: string): SyncMapping['backend'] | undefined =>
  text.startsWith(legacyCommentPrefixes.linear) ? 'linear' : text.startsWith(legacyCommentPrefixes.github) ? 'github' : undefined

export class LegacySyncMappings {
  static readonly schema = legacyMappingSchema
  static readonly commentBackend = legacyCommentBackend
}
