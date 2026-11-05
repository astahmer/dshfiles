import { defineApi, method, type ApiContract } from '@dshfiles/dshx/api'
import { Schema, type Effect } from 'effect'

/**
 * The backlog provider port: one remote source of items (Linear, GitHub Issues, a folder of markdown files, Notion…).
 * Providers speak the backlog's canonical vocabulary, so the sync engine never sees a GraphQL or REST shape.
 *
 * Built-in providers implement `BacklogProvider` in-process; a provider from another plugin serves the `backlog-provider`
 * Host API (`BacklogProviders.contract(owner)`) and the backlog lists it with `listApis`, the `vcs-provider-port` way.
 */

const statuses = ['inbox', 'todo', 'doing', 'done', 'dropped'] as const
const kinds = ['task', 'bug', 'idea', 'note', 'question'] as const
const priorities = ['none', 'urgent', 'high', 'medium', 'low'] as const
/** The item-to-item relations a provider may express; `parent` is its own field. */
const relations = ['related', 'depends-on', 'blocks', 'duplicates'] as const

const kindSlug = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,31}$/))
const shortText = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const keyText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300))
const timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const statusSchema = Schema.Literals(statuses)
const prioritySchema = Schema.Literals(priorities)
const relationSchema = Schema.Literals(relations)

const capabilitiesSchema = Schema.Struct({
  read: Schema.Boolean,
  write: Schema.Boolean,
  create: Schema.Boolean,
  /** What deleting a backlog item does to its remote item: leave it, close it (status dropped), archive it or delete it. */
  delete: Schema.Literals(['none', 'close', 'archive', 'delete']),
  /** How the remote models status: GitHub's open/closed, Linear's typed workflow states, Jira transitions, a Notion select. */
  statusModel: Schema.Literals(['open-closed', 'categories', 'workflow-transitions', 'free-select']),
  bodyFormat: Schema.Literals(['markdown', 'plain', 'rich']),
  comments: Schema.Literals(['none', 'read', 'read-write']),
  labels: Schema.Boolean,
  priority: Schema.Boolean,
  parent: Schema.Boolean,
  relations: Schema.Array(relationSchema),
  /** How a pull finds what changed: an `updatedAt` cursor, an ETag poll of a since-filtered list, or a full scan. */
  changeFeed: Schema.Literals(['since-cursor', 'etag-poll', 'full-scan']),
  rateLimit: Schema.NullOr(Schema.Struct({ requestsPerHour: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)) })),
})

const descriptorSchema = Schema.Struct({
  kind: kindSlug,
  label: shortText(60),
  capabilities: capabilitiesSchema,
  /** What a binding's container is called: Team, Repository, Folder, Database. */
  containerLabel: shortText(40),
  /** Whether a connection needs a key: `none` for local sources such as a folder. */
  credential: Schema.Literals(['required', 'optional', 'none']),
  /** Host environment variables read when a connection binds no key, first set wins. */
  environmentVariables: Schema.Array(shortText(80)),
  /** Regular expressions (source text, case-insensitive) that recognize one of this provider's issue references. */
  referencePatterns: Schema.Array(shortText(300)),
  /** An example reference, for placeholders and recovery messages. */
  referenceExample: shortText(120),
})

/** An account as the provider receives it: the credential stays a `secret:ALIAS` reference the provider resolves. */
const connectionSchema = Schema.Struct({
  instanceId: kindSlug,
  kind: kindSlug,
  label: shortText(80),
  credential: shortText(400),
  baseUrl: shortText(500),
})

const containerSchema = Schema.Struct({ key: shortText(500), name: shortText(200), url: Schema.optionalKey(shortText(500)) })

/** Who a connection signs in as, and the containers it can see. */
const identitySchema = Schema.Struct({
  account: shortText(200),
  credentialSource: Schema.Literals(['reference', 'environment', 'cli', 'none']),
  containers: Schema.Array(containerSchema),
})

/**
 * A remote status in canonical terms: `category` is the backlog status it reads as, `label` the remote's own name, and
 * `equivalents` every backlog status it can stand for (GitHub's open stands for inbox, todo and doing), so a lossy
 * remote never reads `doing` as a change.
 */
const remoteStatusSchema = Schema.Struct({ category: statusSchema, label: shortText(120), equivalents: Schema.Array(statusSchema) })
const remoteCommentSchema = Schema.Struct({ id: keyText, body: shortText(40_000), author: shortText(200), createdAt: timestamp })
const remoteRelationSchema = Schema.Struct({ relation: relationSchema, key: keyText })

/** One remote item, already in backlog vocabulary. Optional fields are absent when the provider cannot express them. */
const recordSchema = Schema.Struct({
  key: keyText,
  displayKey: shortText(200),
  url: shortText(500),
  title: shortText(1_000),
  body: shortText(80_000),
  status: Schema.NullOr(remoteStatusSchema),
  tags: Schema.Array(shortText(120)),
  kind: Schema.optionalKey(Schema.Literals(kinds)),
  priority: Schema.optionalKey(prioritySchema),
  parentKey: Schema.optionalKey(Schema.NullOr(keyText)),
  relations: Schema.optionalKey(Schema.Array(remoteRelationSchema)),
  /** Absent when this read did not load comments; `fetch` loads them. */
  comments: Schema.optionalKey(Schema.Array(remoteCommentSchema)),
  updatedAt: timestamp,
  /** An opaque version (updatedAt, ETag, content hash) that changes whenever the remote item does. */
  version: shortText(200),
  /** The remote item is gone or closed for good (a deleted file, a deleted issue). */
  deleted: Schema.optionalKey(Schema.Boolean),
})

/** The fields a sync may ask a provider to read or write. */
const fields = ['title', 'body', 'status', 'tags', 'priority', 'parent', 'links'] as const
const fieldSchema = Schema.Literals(fields)

/** What to write; absent fields stay as they are. `relations` and `tags` replace the whole set. */
const patchSchema = Schema.Struct({
  title: Schema.optionalKey(shortText(1_000)),
  body: Schema.optionalKey(shortText(80_000)),
  status: Schema.optionalKey(statusSchema),
  /** The remote status name a binding's value map chose for `status`, when it has one. */
  statusLabel: Schema.optionalKey(shortText(120)),
  tags: Schema.optionalKey(Schema.Array(shortText(120))),
  kind: Schema.optionalKey(Schema.Literals(kinds)),
  priority: Schema.optionalKey(prioritySchema),
  parentKey: Schema.optionalKey(Schema.NullOr(keyText)),
  relations: Schema.optionalKey(Schema.Array(remoteRelationSchema)),
  /** On create: the backlog ref of the item, for a provider that names what it creates after it (a file). */
  localRef: Schema.optionalKey(shortText(16)),
})

/** Where a call happens: the connection, the binding's container (may be empty) and the project the call serves. */
const scopeFields = {
  connection: connectionSchema,
  container: shortText(500),
  project: Schema.NullOr(shortText(500)),
} satisfies Schema.Struct.Fields

const pullInputSchema = Schema.Struct({
  ...scopeFields,
  /** The checkpoint the last complete pull returned; null pulls from the start. */
  cursor: Schema.NullOr(shortText(2_000)),
  /** The page token of the previous page of this pull; null for the first page. */
  page: Schema.NullOr(shortText(2_000)),
  fields: Schema.Array(fieldSchema),
  /** Only open items: what a first import wants. */
  openOnly: Schema.Boolean,
})

const pullPageSchema = Schema.Struct({
  records: Schema.Array(recordSchema),
  /** The next page of this pull, or null on the last page. */
  nextPage: Schema.NullOr(shortText(2_000)),
  /** On the last page: the cursor the next pull starts from. */
  checkpoint: Schema.NullOr(shortText(2_000)),
  /** The pages together hold every item of the container, so a key missing from them was removed remotely. */
  complete: Schema.Boolean,
})

const methods = {
  describe: method({
    input: Schema.Struct({}),
    output: Schema.Struct({ providers: Schema.Array(descriptorSchema) }),
    description: 'The provider kinds this plugin serves, with their capabilities and reference patterns. Read-only.',
  }),
  identity: method({
    input: Schema.Struct({ connection: connectionSchema }),
    output: identitySchema,
    description: 'Who a connection signs in as and the containers it can see; writes nothing.',
  }),
  pull: method({
    input: pullInputSchema,
    output: pullPageSchema,
    description: 'One page of the items changed since the cursor, in backlog vocabulary. Read-only.',
  }),
  fetch: method({
    input: Schema.Struct({ ...scopeFields, key: keyText, fields: Schema.Array(fieldSchema) }),
    output: recordSchema,
    description: 'One item with its comments. Read-only.',
  }),
  resolve: method({
    input: Schema.Struct({ ...scopeFields, reference: shortText(500) }),
    output: recordSchema,
    description: 'The item a reference (a URL, an identifier, a number) names. Read-only.',
  }),
  push: method({
    input: Schema.Struct({ ...scopeFields, key: keyText, patch: patchSchema }),
    output: recordSchema,
    description: 'Write the given fields to one item and answer it as it now is.',
  }),
  create: method({
    input: Schema.Struct({ ...scopeFields, patch: patchSchema }),
    output: recordSchema,
    description: 'Create one item from the given fields.',
  }),
  comment: method({
    input: Schema.Struct({ ...scopeFields, key: keyText, body: shortText(40_000) }),
    output: remoteCommentSchema,
    description: 'Add one comment to an item.',
  }),
}

export type BacklogProviderMethods = typeof methods
export type ProviderCapabilities = typeof capabilitiesSchema.Type
export type ProviderDescriptor = typeof descriptorSchema.Type
export type ProviderConnection = typeof connectionSchema.Type
export type ProviderContainer = typeof containerSchema.Type
export type ProviderIdentity = typeof identitySchema.Type
export type RemoteStatus = typeof remoteStatusSchema.Type
export type RemoteComment = typeof remoteCommentSchema.Type
export type RemoteRelation = typeof remoteRelationSchema.Type
export type RemoteRecord = typeof recordSchema.Type
export type RemotePatch = typeof patchSchema.Type
export type ProviderField = (typeof fields)[number]
export type PullInput = typeof pullInputSchema.Type
export type PullPage = typeof pullPageSchema.Type
export type ProviderScope = { readonly connection: ProviderConnection; readonly container: string; readonly project: string | null }

/** Why a provider call failed, in terms the sync engine records and the user can act on. */
const failureCodes = ['not-found', 'rejected', 'transport', 'invalid-response', 'credential-missing', 'target-missing', 'unsupported'] as const
export type ProviderFailureCode = (typeof failureCodes)[number]

/** A provider call that failed: what kind of failure, and the remote detail without any credential. */
export class BacklogProviderFailed extends Schema.TaggedError<BacklogProviderFailed>()(
  'BacklogProviderFailed',
  {
    provider: Schema.String,
    code: Schema.Literals(failureCodes),
    status: Schema.optional(Schema.Number),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'backlog-provider-failed' },
) {
  override get message(): string {
    const settings = 'Open Backlog settings › Remote sync'
    const detail = this.detail === '' ? '' : ` (${this.detail.slice(0, 300)})`
    switch (this.code) {
      case 'not-found':
        return `${this.provider} has no item matching that reference${detail}. Paste an identifier or URL from the bound container, then retry.`
      case 'rejected':
        return this.status === 401 || this.status === 403
          ? `${this.provider} refused the key${detail}. ${settings}, check that the connection's key is valid and can read and write there, then retry.`
          : this.status === 429
            ? `${this.provider} rate-limited the request${detail}. Wait a minute, then retry.`
            : `${this.provider} refused the request (${String(this.status ?? 400)})${detail}. ${settings}, check the binding's container, then retry.`
      case 'transport':
        return `${this.provider} could not be reached${detail}. Check the Host's network connection, then use Sync now; local edits are kept and sync on the next pass.`
      case 'invalid-response':
        return `${this.provider} answered in an unexpected shape${detail}. Retry with Sync now; if it keeps failing, check the Host log and report it.`
      case 'credential-missing':
        return `The ${this.provider} key does not resolve${detail}. ${settings}, set the connection's key to a Secret Catalog reference (secret:ALIAS), then retry.`
      case 'target-missing':
        return `${this.provider} has no container to use${detail}. ${settings}, pick one for the binding, then retry.`
      case 'unsupported':
        return `${this.provider} cannot do that${detail}. Change the binding's direction or field map in Backlog settings › Remote sync.`
    }
  }
}

/**
 * One provider kind, in-process. `toCanonical`/`fromCanonical` live inside it: every record it answers is already
 * canonical, and every patch it receives is canonical too.
 */
export interface BacklogProvider {
  readonly descriptor: ProviderDescriptor
  readonly identity: (connection: ProviderConnection) => Effect.Effect<ProviderIdentity, BacklogProviderFailed>
  readonly pull: (input: PullInput) => Effect.Effect<PullPage, BacklogProviderFailed>
  readonly fetch: (
    input: ProviderScope & { readonly key: string; readonly fields: readonly ProviderField[] },
  ) => Effect.Effect<RemoteRecord, BacklogProviderFailed>
  readonly resolve: (input: ProviderScope & { readonly reference: string }) => Effect.Effect<RemoteRecord, BacklogProviderFailed>
  readonly push: (input: ProviderScope & { readonly key: string; readonly patch: RemotePatch }) => Effect.Effect<RemoteRecord, BacklogProviderFailed>
  readonly create: (input: ProviderScope & { readonly patch: RemotePatch }) => Effect.Effect<RemoteRecord, BacklogProviderFailed>
  readonly comment: (input: ProviderScope & { readonly key: string; readonly body: string }) => Effect.Effect<RemoteComment, BacklogProviderFailed>
}

/** Every provider kind shares one Host API id and method set, and differs by owner. */
export class BacklogProviders {
  static readonly apiId = 'backlog-provider'
  static readonly statuses = statuses
  static readonly priorities = priorities
  static readonly relations = relations
  static readonly fields = fields
  static readonly failureCodes = failureCodes
  static readonly descriptorSchema = descriptorSchema
  static readonly capabilitiesSchema = capabilitiesSchema
  static readonly connectionSchema = connectionSchema
  static readonly containerSchema = containerSchema
  static readonly identitySchema = identitySchema
  static readonly recordSchema = recordSchema
  static readonly patchSchema = patchSchema
  static readonly remoteCommentSchema = remoteCommentSchema
  static readonly remoteRelationSchema = remoteRelationSchema
  static readonly fieldSchema = fieldSchema
  static readonly relationSchema = relationSchema

  static contract(owner: string): ApiContract<BacklogProviderMethods> {
    return defineApi({ id: BacklogProviders.apiId, version: 1, owner, methods })
  }

  /** A status every backlog status reads as itself: what a provider with typed states answers. */
  static exactStatus(status: (typeof statuses)[number], label: string = status): RemoteStatus {
    return { category: status, label, equivalents: [status] }
  }

  /** Whether `reference` matches one of a descriptor's patterns. */
  static recognizes(descriptor: Pick<ProviderDescriptor, 'referencePatterns'>, reference: string): boolean {
    const trimmed = reference.trim()
    return descriptor.referencePatterns.some(pattern => {
      try {
        return new RegExp(pattern, 'iu').test(trimmed)
      } catch {
        return false
      }
    })
  }
}
