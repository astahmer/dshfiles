import { Schema } from 'effect'

const backendSchema = Schema.Literals(['linear', 'github'])
const label = (backend: 'linear' | 'github'): string => (backend === 'linear' ? 'Linear' : 'GitHub')
const settingsHint = 'Open Backlog settings › Remote sync'

/** No enabled backend row serves the item's project. */
export class SyncBackendUnconfigured extends Schema.TaggedError<SyncBackendUnconfigured>()(
  'SyncBackendUnconfigured',
  { backend: backendSchema, project: Schema.NullOr(Schema.String) },
  { dshxWireCode: 'sync-backend-unconfigured' },
) {
  override get message(): string {
    const where = this.project === null ? 'items without a project' : this.project
    return `No enabled ${label(this.backend)} backend is configured for ${where}. ${settingsHint}, add a ${label(this.backend)} row for that project (or leave its project empty to serve every project), then retry.`
  }
}

/** The backend row names no resolvable credential. */
export class SyncCredentialMissing extends Schema.TaggedError<SyncCredentialMissing>()(
  'SyncCredentialMissing',
  { backend: backendSchema, environmentVariable: Schema.String },
  { dshxWireCode: 'sync-credential-missing' },
) {
  override get message(): string {
    const cli = this.backend === 'github' ? ', or run `gh auth login` on the Host' : ''
    return `The ${label(this.backend)} key does not resolve. ${settingsHint} and set its key to a Secret Catalog reference (secret:ALIAS), set ${this.environmentVariable} in the DSH Host environment${cli}, then retry.`
  }
}

/** The row names no team or repository, and none could be found on its own. */
export class SyncTargetMissing extends Schema.TaggedError<SyncTargetMissing>()(
  'SyncTargetMissing',
  { backend: backendSchema, project: Schema.NullOr(Schema.String) },
  { dshxWireCode: 'sync-target-missing' },
) {
  override get message(): string {
    if (this.backend === 'linear') return `The Linear key sees several teams. ${settingsHint}, pick a team for this backend, then retry.`
    const where = this.project === null ? 'Items without a project have' : `${this.project} has`
    return `${where} no github.com git remote to take the repository from. ${settingsHint}, set the repository as owner/repo, then retry.`
  }
}

/** The remote answered, but refused the request (auth, permissions, validation). */
export class SyncRemoteRejected extends Schema.TaggedError<SyncRemoteRejected>()(
  'SyncRemoteRejected',
  { backend: backendSchema, status: Schema.Number, detail: Schema.String },
  { dshxWireCode: 'sync-remote-rejected' },
) {
  override get message(): string {
    const recovery =
      this.status === 401 || this.status === 403
        ? 'Check that the key is valid and can read and write issues there, then retry.'
        : this.status === 429
          ? 'The rate limit was reached; wait a minute, then retry.'
          : 'Check the team or repository in Backlog settings › Remote sync, then retry.'
    return `${label(this.backend)} refused the request (${String(this.status)}${this.detail === '' ? '' : `: ${this.detail.slice(0, 300)}`}). ${recovery}`
  }
}

/** The network call itself failed or timed out. */
export class SyncTransportFailed extends Schema.TaggedError<SyncTransportFailed>()(
  'SyncTransportFailed',
  { backend: backendSchema, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'sync-transport-failed' },
) {
  override get message(): string {
    return `${label(this.backend)} could not be reached. Check the Host's network connection, then use Sync now to retry; local edits are kept and sync on the next pass.`
  }
}

/** The answer did not have the shape the adapter expects. */
export class SyncResponseInvalid extends Schema.TaggedError<SyncResponseInvalid>()(
  'SyncResponseInvalid',
  { backend: backendSchema, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'sync-response-invalid' },
) {
  override get message(): string {
    return `${label(this.backend)} answered in an unexpected shape. Retry with Sync now; if it keeps failing, check the Host log for the response and report it.`
  }
}

/** The issue reference does not name a reachable issue. */
export class SyncRemoteNotFound extends Schema.TaggedError<SyncRemoteNotFound>()(
  'SyncRemoteNotFound',
  { backend: backendSchema, reference: Schema.String },
  { dshxWireCode: 'sync-remote-not-found' },
) {
  override get message(): string {
    const example = this.backend === 'linear' ? 'an identifier such as ENG-12 or its linear.app URL' : 'an issue number such as 42 or its github.com URL'
    return `No ${label(this.backend)} issue matches “${this.reference.slice(0, 200)}”. Paste ${example} from the configured team or repository, then retry.`
  }
}

/** The text names neither a Linear nor a GitHub issue. */
export class SyncReferenceUnrecognized extends Schema.TaggedError<SyncReferenceUnrecognized>()(
  'SyncReferenceUnrecognized',
  { reference: Schema.String },
  { dshxWireCode: 'sync-reference-unrecognized' },
) {
  override get message(): string {
    return `“${this.reference.slice(0, 200)}” is not a Linear or GitHub issue. Paste ENG-12, #42, owner/repo#42 or the issue URL, then retry.`
  }
}

/** The item is not linked to a remote issue yet. */
export class SyncItemNotLinked extends Schema.TaggedError<SyncItemNotLinked>()(
  'SyncItemNotLinked',
  { itemId: Schema.Number },
  { dshxWireCode: 'sync-item-not-linked' },
) {
  override get message(): string {
    return `b:${String(this.itemId)} is not linked to a remote issue. Use “Link to Linear issue…” or “Create in Linear” from its menu first.`
  }
}

/** The item already mirrors another issue. */
export class SyncAlreadyLinked extends Schema.TaggedError<SyncAlreadyLinked>()(
  'SyncAlreadyLinked',
  { itemId: Schema.Number, remoteKey: Schema.String },
  { dshxWireCode: 'sync-already-linked' },
) {
  override get message(): string {
    return `b:${String(this.itemId)} is already linked to ${this.remoteKey}. Unlink it from its menu first to link another issue.`
  }
}

/** The mapping could not be stored. */
export class SyncWriteFailed extends Schema.TaggedError<SyncWriteFailed>()(
  'SyncWriteFailed',
  { itemId: Schema.Number, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'sync-write-failed' },
) {
  override get message(): string {
    return `The sync state of b:${String(this.itemId)} could not be saved. Retry; if it keeps failing, check the Host log for the storage error.`
  }
}

export type RemoteBackendError = SyncRemoteRejected | SyncTransportFailed | SyncResponseInvalid | SyncRemoteNotFound | SyncTargetMissing
