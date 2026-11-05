import { Schema } from 'effect'

const settingsHint = 'Open Backlog settings › Remote sync'
/** An item named by its ref when the caller knows it, else by its number. */
const itemLabel = (error: { readonly itemId: number; readonly ref?: string | undefined }): string => `b:${error.ref ?? String(error.itemId)}`

/** No enabled binding of that provider serves the item's project. */
export class SyncBindingMissing extends Schema.TaggedError<SyncBindingMissing>()(
  'SyncBindingMissing',
  { provider: Schema.String, project: Schema.NullOr(Schema.String) },
  { dshxWireCode: 'sync-binding-missing' },
) {
  override get message(): string {
    const where = this.project === null ? 'items without a project' : this.project
    return `No enabled ${this.provider} binding serves ${where}. ${settingsHint}, add a binding to a ${this.provider} connection scoped to that project (or to every project), then retry.`
  }
}

/** A binding or call names a connection that does not exist. */
export class SyncConnectionMissing extends Schema.TaggedError<SyncConnectionMissing>()(
  'SyncConnectionMissing',
  { connection: Schema.String },
  { dshxWireCode: 'sync-connection-missing' },
) {
  override get message(): string {
    return `No connection “${this.connection.slice(0, 80)}” exists. ${settingsHint}, add the connection or pick an existing one, then retry.`
  }
}

/** A binding id names no binding. */
export class SyncBindingUnknown extends Schema.TaggedError<SyncBindingUnknown>()(
  'SyncBindingUnknown',
  { binding: Schema.String },
  { dshxWireCode: 'sync-binding-unknown' },
) {
  override get message(): string {
    return `No binding “${this.binding.slice(0, 80)}” exists. ${settingsHint} to see the bindings, then retry with one of them.`
  }
}

/** A connection's provider kind is not served by any loaded plugin. */
export class SyncProviderUnknown extends Schema.TaggedError<SyncProviderUnknown>()(
  'SyncProviderUnknown',
  { kind: Schema.String },
  { dshxWireCode: 'sync-provider-unknown' },
) {
  override get message(): string {
    return `No loaded plugin provides “${this.kind.slice(0, 40)}” items. Enable the plugin that serves it in Settings › Plugins, or remove the connection in Backlog settings › Remote sync.`
  }
}

/** The binding runs on another Host. */
export class SyncNotOwner extends Schema.TaggedError<SyncNotOwner>()(
  'SyncNotOwner',
  { binding: Schema.String, ownerHostId: Schema.String },
  { dshxWireCode: 'sync-not-owner' },
) {
  override get message(): string {
    return `The binding “${this.binding.slice(0, 80)}” syncs from another Host (${this.ownerHostId.slice(0, 12)}). Run the sync there, or ${settingsHint} and move the binding to this Host.`
  }
}

/** A connection or binding the caller wants to save does not hold together. */
export class SyncConfigInvalid extends Schema.TaggedError<SyncConfigInvalid>()(
  'SyncConfigInvalid',
  { detail: Schema.String },
  { dshxWireCode: 'sync-config-invalid' },
) {
  override get message(): string {
    return `${this.detail.slice(0, 400)} Fix it in Backlog settings › Remote sync, then save again.`
  }
}

/** The text names no issue of any loaded provider. */
export class SyncReferenceUnrecognized extends Schema.TaggedError<SyncReferenceUnrecognized>()(
  'SyncReferenceUnrecognized',
  { reference: Schema.String, examples: Schema.Array(Schema.String) },
  { dshxWireCode: 'sync-reference-unrecognized' },
) {
  override get message(): string {
    const examples = this.examples.length === 0 ? 'an issue URL' : this.examples.join(', ')
    return `“${this.reference.slice(0, 200)}” names no issue of a connected provider. Paste ${examples}, or pass the binding to import from, then retry.`
  }
}

/** The item is not linked to a remote item yet. */
export class SyncItemNotLinked extends Schema.TaggedError<SyncItemNotLinked>()(
  'SyncItemNotLinked',
  { itemId: Schema.Number, ref: Schema.optional(Schema.String) },
  { dshxWireCode: 'sync-item-not-linked' },
) {
  override get message(): string {
    return `${itemLabel(this)} is not linked to a remote item. Use “Link to…” or “Create in…” from its menu first.`
  }
}

/** The item already mirrors another remote item in that binding, or the remote item mirrors another backlog item. */
export class SyncAlreadyLinked extends Schema.TaggedError<SyncAlreadyLinked>()(
  'SyncAlreadyLinked',
  { itemId: Schema.Number, ref: Schema.optional(Schema.String), remoteKey: Schema.String },
  { dshxWireCode: 'sync-already-linked' },
) {
  override get message(): string {
    return `${itemLabel(this)} is already linked to ${this.remoteKey}. Unlink it from its menu first to link another issue.`
  }
}

/** The sync state could not be stored. */
export class SyncWriteFailed extends Schema.TaggedError<SyncWriteFailed>()(
  'SyncWriteFailed',
  { itemId: Schema.Number, ref: Schema.optional(Schema.String), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'sync-write-failed' },
) {
  override get message(): string {
    return `The sync state of ${itemLabel(this)} could not be saved. Retry; if it keeps failing, check the Host log for the storage error.`
  }
}

/** The connections and bindings could not be stored. */
export class SyncConfigWriteFailed extends Schema.TaggedError<SyncConfigWriteFailed>()(
  'SyncConfigWriteFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'sync-config-write-failed' },
) {
  override get message(): string {
    return 'The remote sync settings could not be saved. Retry; if it keeps failing, check the Host log for the storage error.'
  }
}
