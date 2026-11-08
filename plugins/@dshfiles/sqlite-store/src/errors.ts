import { Schema } from 'effect'

export class SqliteStoreOpenFailed extends Schema.TaggedError<SqliteStoreOpenFailed>()('SqliteStoreOpenFailed', {
  filename: Schema.String,
  step: Schema.Literals(['prepare-files', 'open', 'pragmas', 'restrict-files']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not open the SQLite store ${this.filename} (${this.step}).`
  }
}

export class SqliteMigrationFailed extends Schema.TaggedError<SqliteMigrationFailed>()('SqliteMigrationFailed', {
  filename: Schema.String,
  kind: Schema.Literals(['BadState', 'ImportError', 'Failed', 'Duplicates', 'Locked', 'Sql']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Migrating the SQLite store ${this.filename} failed (${this.kind}); its schema was left unchanged.`
  }
}

export class SqliteStoreVersionUnsupported extends Schema.TaggedError<SqliteStoreVersionUnsupported>()('SqliteStoreVersionUnsupported', {
  filename: Schema.String,
  source: Schema.Literals(['user-version', 'migrations']),
  foundVersion: Schema.Int,
  supportedVersion: Schema.Int,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The SQLite store ${this.filename} is at ${this.source} ${String(this.foundVersion)}, newer than the ${String(this.supportedVersion)} this build knows; update the plugin that owns it.`
  }
}

export type SqliteStoreError = SqliteStoreOpenFailed | SqliteMigrationFailed | SqliteStoreVersionUnsupported | DeferredStoreMemberMissing

/** A deferred store was read for a member it does not expose as a method; nothing can start the build for it. */
export class DeferredStoreMemberMissing extends Schema.TaggedError<DeferredStoreMemberMissing>()('DeferredStoreMemberMissing', {
  service: Schema.String,
  member: Schema.String,
}) {
  override get message(): string {
    return `sqlite-store: ${this.service}.${this.member} is not a method, so a deferred store cannot forward it`
  }
}
