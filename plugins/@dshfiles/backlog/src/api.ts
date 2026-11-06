import { defineApi, event, method } from '@dshfiles/dshx/api'
import { Effect, Schema, SchemaGetter } from 'effect'
import { AgentConfirmation } from './agent-confirmation.js'
import { BacklogBackfill } from './backfill.js'
import { BacklogReference } from './backlog-reference.js'
import { DueDates } from './due-date.js'
import { Recurrence } from './recurrence.js'
import { BacklogGates } from './gates.js'
import { timingSchema } from '@dshfiles/project-automations/api'
import { BacklogItems } from './item.js'
import { BacklogShipped } from './shipped.js'
import { BacklogProviders } from './provider-port.js'
import { BacklogSyncModel } from './sync-model.js'
import { BacklogPeerWire } from './peer-wire.js'

const idSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const refTextSchema = Schema.String.check(
  Schema.makeFilter(value => (BacklogReference.parse(value) === undefined ? 'Expected a backlog reference such as b:k3f9, k3f9 or a legacy 12.' : undefined)),
)
/** An item a caller names: its `b:<ref>` (`b:k3f9`, `k3f9`, a legacy `b:12` or `12`), or the number an older caller sends. */
const itemKeySchema = Schema.Union([idSchema, refTextSchema]).annotate({
  description: 'The item: its reference as written (`b:k3f9`, `k3f9`, or a legacy `b:12`), or its number.',
})
/** The `b:<ref>` an item shows; a Host older than short aliases answers without it, and `BacklogReference.refOf` falls back to the id. */
const refOutputSchema = Schema.optionalKey(Schema.String)
const freshnessSchema = Schema.Literals(BacklogItems.freshnessStates)
const fileInputSchema = Schema.Struct({
  ...BacklogItems.attachmentPayloadFields,
  data: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(24_000_000)),
})
const agentContinuationCandidateSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  title: Schema.String.check(Schema.isMaxLength(200)),
})

const commentHasBody = (input: { readonly text: string; readonly files?: readonly unknown[] | undefined }): boolean =>
  input.text.trim().length > 0 || (input.files?.length ?? 0) > 0

const commentInputSchema = Schema.Struct({
  id: itemKeySchema,
  text: Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars)).annotate({
    description: 'Reply text; it may be empty only when the comment includes an attachment.',
  }),
  files: Schema.Array(fileInputSchema)
    .check(Schema.isMaxLength(BacklogItems.maxAttachments))
    .pipe(Schema.optional)
    .annotate({ description: 'Images or files the comment carries: base64 `data` without a data-URL prefix, with kind, name, media type and byte size.' }),
}).check(Schema.makeFilter(input => (commentHasBody(input) ? undefined : 'A comment needs text or at least one attachment.')))
const fileOutputSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({ dataUrl: Schema.String.check(Schema.isMinLength(1)), path: Schema.optional(Schema.String.check(Schema.isMinLength(1))) }),
  }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('not-found') }),
])
const speechStatusSchema = Schema.Struct({
  available: Schema.Boolean,
  ready: Schema.Boolean,
  provider: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
})
const jevSetupStatusSchema = Schema.Struct({ needsSetup: Schema.Boolean })
const replyRouteSchema = Schema.Struct({
  route: Schema.Literals(['reply', 'thread']),
  confidence: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  source: Schema.Literals(['jev', 'keywords']),
})
const transcriptionSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), text: Schema.String }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String.check(Schema.isMaxLength(500)) }),
])

const leaseSchema = Schema.Struct({
  holder: Schema.String,
  acquiredAt: Schema.Number.check(Schema.isFinite()),
  expiresAt: Schema.Number.check(Schema.isFinite()),
})
const criterionInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,40}$/)).pipe(Schema.optional),
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  done: Schema.Boolean.pipe(Schema.optional),
})
const nullDefault = <S extends Schema.Top>(schema: S) => Schema.NullOr(schema).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null)))
const countSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const summarySchema = Schema.Struct({
  id: idSchema,
  ref: refOutputSchema,
  title: Schema.String,
  kind: BacklogItems.kindSchema,
  status: BacklogItems.statusSchema,
  project: Schema.NullOr(Schema.String),
  tags: Schema.Array(Schema.String),
  links: Schema.Array(BacklogItems.linkSchema),
  tweetContextUrls: Schema.optional(Schema.Array(BacklogItems.tweetContextUrlSchema).check(Schema.isMaxLength(20))),
  /** A Host older than item attachments answers without them; the default keeps the client from dereferencing undefined. */
  attachments: Schema.Array(BacklogItems.attachmentSchema)
    .check(Schema.isMaxLength(BacklogItems.maxAttachments))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  actors: Schema.Array(BacklogItems.actorSchema),
  pinned: Schema.Boolean,
  freshness: freshnessSchema,
  createdAt: Schema.Number.check(Schema.isFinite()),
  lastActivityAt: Schema.Number.check(Schema.isFinite()),
  preview: Schema.String,
  proposal: Schema.NullOr(BacklogItems.proposalSchema),
  attention: BacklogItems.attentionSchema,
  acknowledgedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  snoozedUntil: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  activity: Schema.Struct({
    count: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    agents: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    comments: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    last: Schema.NullOr(
      Schema.Struct({
        at: Schema.Number.check(Schema.isFinite()),
        actor: Schema.String,
        kind: Schema.String,
        detail: Schema.String,
      }),
    ),
  }),
  match: Schema.NullOr(
    Schema.Struct({
      fields: Schema.Array(Schema.Literals(['id', 'title', 'tag', 'body', 'comment', 'link', 'project', 'capture'])),
      snippet: Schema.NullOr(Schema.String),
    }),
  ),
  /** The fields below came with priorities, sub-issues and claims; a Host that predates them answers without, and these defaults fill in. */
  priority: BacklogItems.prioritySchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('none'))),
  parent: nullDefault(Schema.String),
  /** Who captured it: `user`, `system` or `agent:<sessionId>`. */
  owner: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed('user'))),
  /** The agent working on it for its owner, `agent:<sessionId>`. */
  delegate: nullDefault(Schema.String),
  /** Direct sub-issues done out of those counted (dropped ones leave the total). */
  children: Schema.Struct({ total: countSchema, done: countSchema }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({ total: 0, done: 0 }))),
  /** Open, unsnoozed, nothing open blocking it, no open sub-issue, and nobody holding a live claim. */
  ready: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** Refs of the open items it waits on (`depends-on` it, or `blocks` it). */
  blockedBy: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** The live claim on it, if any. */
  lease: nullDefault(leaseSchema),
  /** Acceptance criteria checked out of all of them; a Host that predates criteria answers none. */
  criteriaProgress: Schema.Struct({ total: countSchema, done: countSchema }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({ total: 0, done: 0 }))),
  /** `pending` while the plan waits for the user's approval. */
  planApproval: nullDefault(BacklogItems.planApprovalSchema),
  /** The date it is due, and whether it is past while still open (from the Host's calendar). */
  due: nullDefault(Schema.String),
  overdue: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** How it repeats: finishing it creates the next occurrence. */
  recurrence: nullDefault(Schema.String),
  /** Outside conditions it waits on, and whether each still holds it back. */
  gates: Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.Literals(BacklogGates.kinds), target: Schema.String, open: Schema.Boolean })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
})

const detailSchema = Schema.Struct({
  item: Schema.Struct({ ...BacklogItems.itemSchema.fields, freshness: freshnessSchema }),
  backlinks: Schema.Array(summarySchema),
  /** The item this one is a sub-issue of. */
  parentItem: nullDefault(summarySchema),
  children: Schema.Array(summarySchema).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  blockedBy: Schema.Array(summarySchema).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  lease: nullDefault(leaseSchema),
  /** The project's standing instructions for agents (Projects view › overview); follow them while working on the item. */
  guidance: nullDefault(Schema.String),
})

const detailResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: detailSchema }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('not-found') }),
])

const mergeResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: detailSchema, merged: Schema.Array(Schema.String) }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('not-found') }),
])

const pullRequestViewSchema = Schema.Struct({
  url: Schema.String,
  repo: Schema.String,
  number: countSchema,
  state: Schema.Literals(['open', 'merged', 'closed', 'unknown']),
  checks: Schema.Literals(['passing', 'failing', 'pending', 'none']),
  watched: Schema.Boolean,
})
const pullRequestsOutputSchema = Schema.Struct({ available: Schema.Boolean, pullRequests: Schema.Array(pullRequestViewSchema) })
const pullRequestUrlSchema = Schema.String.check(
  Schema.isMaxLength(BacklogItems.maxTargetChars),
  Schema.makeFilter(value => (BacklogGates.pullRequestOf(value) === null ? 'Expected a GitHub pull request or GitLab merge request URL.' : undefined)),
)

const renderPullRequests = (output: typeof pullRequestsOutputSchema.Type): string =>
  !output.available
    ? 'The pull-requests plugin is not loaded: PR links stay plain URLs.'
    : output.pullRequests
        .map(pull => `${pull.repo}#${String(pull.number)} ${pull.state} · checks ${pull.checks}${pull.watched ? '' : ' · not watched'}`)
        .join('\n') || 'No pull requests linked.'

const revertResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: detailSchema }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('not-found') }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('stale'), message: Schema.String.check(Schema.isMaxLength(1_000)) }),
])

const renderRevertPreview = (result: typeof revertResultSchema.Type): string =>
  result.ok ? renderItemPreview(result.value.item) : result.reason === 'stale' ? result.message : 'No such change on that backlog item.'

const detailManySchema = Schema.Struct({
  items: Schema.Array(detailSchema),
  missing: Schema.Array(itemKeySchema),
})

/** An empty string means "no filter", so decoding folds it to an absent actor while the id itself stays strict. */
const actorFilterSchema = Schema.Union([Schema.Literal(''), BacklogItems.actorIdSchema]).pipe(
  Schema.decodeTo(Schema.UndefinedOr(BacklogItems.actorIdSchema), {
    decode: SchemaGetter.transform(actor => (actor === '' ? undefined : actor)),
    encode: SchemaGetter.transform(actor => actor ?? ''),
  }),
)

const listInputSchema = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(500)).pipe(Schema.optional).annotate({
    description:
      'Words that must all match (title, tags, body, comments, original capture, project, links; "quoted phrases" stay whole), plus optional operators: kind:bug status:doing is:blocked #tag project:name by:agent (touched by) created:me|agent|system (captured by) has:thread|revision|url|children|parent updated:<7d updated:>30d priority:urgent|high|medium|low|none parent:b:k3f9 is:ready is:blocked-by-deps is:delegated is:claimed delegate:agent has:criteria|plan|summary|due|gate is:plan-pending is:overdue is:gated due:<7d due:>30d. A leading - negates any operator or word (-created:agent, -kind:note, -#tag, -priority:none). Results rank by relevance and say which fields matched.',
  }),
  statuses: Schema.Array(BacklogItems.statusSchema).pipe(Schema.optional),
  kinds: Schema.Array(BacklogItems.kindSchema).pipe(Schema.optional),
  project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
    .pipe(Schema.optional)
    .annotate({ description: 'Absolute project path; null lists items outside any project.' }),
  projects: Schema.Array(Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars))))
    .pipe(Schema.optional)
    .annotate({ description: 'Several absolute project paths; null includes items outside any project, and an empty array applies no project filter.' }),
  tag: Schema.String.check(Schema.isMaxLength(60)).pipe(Schema.optional),
  actor: actorFilterSchema.pipe(Schema.optional).annotate({ description: '`user`, `system` or `agent:<sessionId>`. Empty means no actor filter.' }),
  freshness: Schema.Literals(['active', 'all', ...BacklogItems.freshnessStates])
    .pipe(Schema.optional)
    .annotate({ description: '`active` (default) hides dormant and archived items, like the feed; `all` includes them.' }),
  inbox: Schema.Boolean.pipe(Schema.optional).annotate({
    description: 'Only open items that want the user: attention set, or a triage suggestion waiting; closed items are excluded.',
  }),
  hideAgentItems: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      'Leave out items an agent captured that the user never touched, unless they ask for attention or wait on a suggestion. Defaults to false: every item is listed.',
  }),
  ready: Schema.Boolean.pipe(Schema.optional).annotate({
    description: 'Only ready items (open, unsnoozed, unblocked, no open sub-issue, unclaimed), urgent first then oldest.',
  }),
  limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(2_000)).pipe(Schema.optional),
})

const listOutputSchema = Schema.Struct({
  revision: Schema.Number.check(Schema.isFinite()),
  total: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  items: Schema.Array(summarySchema),
  /** How many matching items `hideAgentItems` left out; a Host without the filter reports none. */
  hiddenAgentItems: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(0)),
  ),
  /** backlog_ready: the agent guidance of the projects its items belong to. */
  guidance: Schema.optionalKey(Schema.Array(Schema.Struct({ project: Schema.String, guidance: Schema.String }))),
})

const previewText = (text: string): string => text.trim().replace(/\s+/g, ' ').slice(0, 240)

const renderItemPreview = (item: (typeof detailSchema.Type)['item']): string => {
  const body = previewText(item.body)
  const status = `${item.kind} · ${item.status}${(item.priority ?? 'none') === 'none' ? '' : ` · ${item.priority ?? ''}`}${item.parent === undefined ? '' : ` · under b:${item.parent}`}`
  const project = item.project === null ? '' : ` · ${item.project}`
  const rollup = BacklogItems.criteriaRollup(item.criteria)
  const sections = [
    ...(rollup.total === 0 ? [] : [`Criteria ${String(rollup.done)}/${String(rollup.total)}: ${BacklogItems.displayValue(item.criteria)}`]),
    ...(item.plan === undefined ? [] : [`Plan${item.planApproval === undefined ? '' : ` (${item.planApproval})`}: ${previewText(item.plan)}`]),
    ...(item.summary === undefined ? [] : [`Summary: ${previewText(item.summary)}`]),
  ]
  return [`${BacklogReference.labelOf(item)} — ${item.title}`, `${status}${project}`, ...(body === '' ? [] : [body]), ...sections].join('\n')
}

const withGuidance = (detail: typeof detailSchema.Type): string =>
  typeof detail.guidance !== 'string' ? renderItemPreview(detail.item) : `${renderItemPreview(detail.item)}\n\nProject guidance:\n${detail.guidance}`

const renderDetailPreview = (result: typeof detailResultSchema.Type): string => (result.ok ? renderItemPreview(result.value.item) : 'No backlog item found.')

const renderGetPreview = (result: typeof detailResultSchema.Type): string => (result.ok ? withGuidance(result.value) : 'No backlog item found.')

const renderCreatedPreview = (detail: typeof detailSchema.Type): string => renderItemPreview(detail.item)

const nonNegativeCountSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const backfillOutputSchema = Schema.Struct({
  retriage: Schema.Boolean,
  jobId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  configured: Schema.Boolean,
  reason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  state: Schema.Literals(['queued', 'running', 'completed', 'failed']),
  total: nonNegativeCountSchema,
  completed: nonNegativeCountSchema,
  applied: nonNegativeCountSchema,
  proposed: nonNegativeCountSchema,
  unchanged: nonNegativeCountSchema,
  failed: nonNegativeCountSchema,
  remaining: nonNegativeCountSchema,
})

const syncStateSchema = Schema.Literals(BacklogSyncModel.syncStates)
const syncErrorViewSchema = Schema.Struct({ code: Schema.String, message: Schema.String })
/** `bindingId` and `connectionLabel` came with bindings: a Host that predates them answers without, and the panel reads its tracker. */
const syncItemSchema = Schema.Struct({
  itemId: idSchema,
  ref: refOutputSchema,
  bindingId: Schema.optionalKey(Schema.String),
  backend: Schema.String,
  connectionLabel: Schema.optionalKey(Schema.String),
  remoteKey: Schema.String,
  url: Schema.String,
  state: syncStateSchema,
  lastSyncedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  lastError: Schema.NullOr(BacklogSyncModel.syncErrorSchema),
  conflicts: Schema.Array(BacklogSyncModel.conflictSchema),
})
const syncResultSchema = Schema.Struct({
  itemId: idSchema,
  ref: refOutputSchema,
  bindingId: Schema.optionalKey(Schema.String),
  remoteKey: Schema.NullOr(Schema.String),
  state: syncStateSchema,
  pulled: Schema.Array(BacklogSyncModel.fieldSchema),
  pushed: Schema.Array(BacklogSyncModel.fieldSchema),
  conflicts: Schema.Array(BacklogSyncModel.conflictSchema),
  commentsPulled: nonNegativeCountSchema,
  commentsPushed: nonNegativeCountSchema,
  error: Schema.NullOr(syncErrorViewSchema),
})
const syncPassSchema = Schema.Struct({
  bindingId: Schema.String,
  records: nonNegativeCountSchema,
  created: nonNegativeCountSchema,
  removed: nonNegativeCountSchema,
  complete: Schema.Boolean,
  results: Schema.Array(syncResultSchema),
})
const credentialViewSchema = Schema.Literals(['reference', 'environment', 'fallback', 'none', 'missing'])
const syncConnectionViewSchema = Schema.Struct({
  connection: BacklogSyncModel.connectionSchema,
  providerLabel: Schema.String,
  available: Schema.Boolean,
  credential: credentialViewSchema,
})
const syncBindingViewSchema = Schema.Struct({
  binding: BacklogSyncModel.bindingSchema,
  providerKind: Schema.String,
  connectionLabel: Schema.String,
  owned: Schema.Boolean,
  linked: nonNegativeCountSchema,
  lastPassAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
})
const syncSourcesSchema = Schema.Struct({
  providers: Schema.Array(BacklogProviders.descriptorSchema),
  connections: Schema.Array(syncConnectionViewSchema),
  bindings: Schema.Array(syncBindingViewSchema),
})
/**
 * `providers`, `connections` and `bindings` came with connections and bindings; a Host that predates them answers
 * `backends` instead, and the panel asks for a Host restart.
 */
const syncStatusSchema = Schema.Struct({
  providers: Schema.optionalKey(Schema.Array(BacklogProviders.descriptorSchema)),
  connections: Schema.optionalKey(Schema.Array(syncConnectionViewSchema)),
  bindings: Schema.optionalKey(Schema.Array(syncBindingViewSchema)),
  backends: Schema.optionalKey(Schema.Array(Schema.Struct({ backend: Schema.String, project: Schema.NullOr(Schema.String), target: Schema.String }))),
  items: Schema.Array(syncItemSchema),
})
const syncConnectionSchema = Schema.Struct({
  ok: Schema.Boolean,
  credential: Schema.Literals(['reference', 'environment', 'cli', 'none', 'missing']),
  account: Schema.NullOr(Schema.String),
  containers: Schema.Array(BacklogProviders.containerSchema),
  error: Schema.NullOr(syncErrorViewSchema),
})
const slugInputSchema = BacklogSyncModel.slugSchema
const connectionInputSchema = Schema.Struct({
  instanceId: slugInputSchema.annotate({ description: 'Stable id of the connection, lowercase with dashes, e.g. github-work.' }),
  kind: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)).annotate({
    description: 'Provider kind: linear, github, files, or one a plugin provides.',
  }),
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  credential: Schema.String.check(Schema.isMaxLength(400))
    .pipe(Schema.optional)
    .annotate({ description: 'secret:ALIAS reference to the key; empty uses the provider’s Host environment variable (or the gh CLI for GitHub).' }),
  baseUrl: Schema.String.check(Schema.isMaxLength(500))
    .pipe(Schema.optional)
    .annotate({ description: 'API base URL for a self-hosted instance; empty uses the provider’s default. Jira needs https://<site>.atlassian.net.' }),
  options: BacklogProviders.bindingOptionsSchema.pipe(Schema.optional).annotate({
    description: 'Provider settings its descriptor lists in connectionOptions, e.g. { email } for Jira. Never a key.',
  }),
})
const connectionDraftSchema = Schema.Struct({
  kind: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  credential: Schema.String.check(Schema.isMaxLength(400)),
  baseUrl: Schema.String.check(Schema.isMaxLength(500)),
  options: BacklogProviders.bindingOptionsSchema.pipe(Schema.optional),
})
const connectionTargetSchema = Schema.Struct({
  connection: slugInputSchema.pipe(Schema.optional).annotate({ description: 'A saved connection id.' }),
  draft: connectionDraftSchema.pipe(Schema.optional).annotate({ description: 'An unsaved connection, as a settings form holds it.' }),
}).check(Schema.makeFilter(input => (input.connection !== undefined || input.draft !== undefined ? undefined : 'Pass `connection` or `draft`.')))
const bindingInputSchema = Schema.Struct({
  id: slugInputSchema
    .pipe(Schema.optional)
    .annotate({ description: 'An existing binding to change; omit to add one. Fields left out keep their saved value.' }),
  connectionId: slugInputSchema.pipe(Schema.optional),
  container: Schema.String.check(Schema.isMaxLength(500))
    .pipe(Schema.optional)
    .annotate({ description: 'Team key, owner/repo or folder. Empty lets the provider derive it from the project (git remote, <project>/backlog).' }),
  scope: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
    .pipe(Schema.optional)
    .annotate({ description: 'Absolute project path, or null to serve every project without a binding of its own.' }),
  direction: Schema.Literals(BacklogSyncModel.directions).pipe(Schema.optional),
  fieldMap: Schema.Array(BacklogSyncModel.fieldRuleSchema).pipe(Schema.optional),
  conflictPolicy: Schema.Literals(BacklogSyncModel.conflictPolicies).pipe(Schema.optional),
  pollEverySec: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(BacklogSyncModel.maxPollSeconds)).pipe(
    Schema.optional,
  ),
  pushAgentComments: Schema.Boolean.pipe(Schema.optional),
  importNew: Schema.Boolean.pipe(Schema.optional),
  enabled: Schema.Boolean.pipe(Schema.optional),
  options: BacklogProviders.bindingOptionsSchema.pipe(Schema.optional).annotate({
    description:
      'Provider-specific settings the provider lists as binding options (Notion: statusProperty, tagsProperty, priorityProperty, parentProperty). Replaces the saved set.',
  }),
})

const renderSyncConnection = (output: typeof syncConnectionSchema.Type): string => {
  if (output.error !== null) return output.error.message
  const containers =
    output.containers.length === 0
      ? ''
      : ` → ${output.containers
          .slice(0, 8)
          .map(container => container.key)
          .join(', ')}${output.containers.length > 8 ? '…' : ''}`
  return `Connected as ${output.account ?? '?'}${containers} (key: ${output.credential}).`
}
const renderSyncSources = (output: typeof syncSourcesSchema.Type): string =>
  output.connections.length === 0
    ? 'No sync connections are saved. Add one under Backlog settings › Remote sync.'
    : output.connections
        .map(view => {
          const bindings = output.bindings.filter(binding => binding.binding.connectionId === view.connection.instanceId)
          return [
            `${view.connection.label} (${view.providerLabel}, ${view.connection.instanceId}; key: ${view.credential})`,
            ...bindings.map(
              binding =>
                `  - ${binding.binding.id}: ${binding.binding.container || '(derived)'} · ${binding.binding.scope ?? 'every project'} · ${binding.binding.direction}${binding.binding.enabled ? '' : ' (disabled)'} · ${String(binding.linked)} linked`,
            ),
          ].join('\n')
        })
        .join('\n')
const renderSavedSyncConnections = (output: {
  readonly results: readonly {
    readonly connection: { readonly label: string; readonly instanceId: string }
    readonly report: typeof syncConnectionSchema.Type
  }[]
}): string =>
  output.results.length === 0
    ? 'No sync connections are saved. Add one under Backlog settings › Remote sync.'
    : output.results.map(result => `${result.connection.label} (${result.connection.instanceId}): ${renderSyncConnection(result.report)}`).join('\n')
const remoteReferenceSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars)).annotate({
  description: 'The remote item: a URL, an identifier such as ENG-12, an issue number such as 42 or owner/repo#42, or a file name.',
})
const providerKindInputSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))

const renderSyncResults = (output: { readonly results: readonly (typeof syncResultSchema.Type)[] }): string =>
  output.results.length === 0
    ? 'No linked items to sync.'
    : output.results
        .map(result =>
          result.error === null
            ? `${BacklogReference.labelOf({ id: result.itemId, ref: result.ref })} ↔ ${result.remoteKey ?? '?'}: ${result.state}${result.pulled.length > 0 ? ` · pulled ${result.pulled.join(', ')}` : ''}${result.pushed.length > 0 ? ` · pushed ${result.pushed.join(', ')}` : ''}`
            : `${BacklogReference.labelOf({ id: result.itemId, ref: result.ref })}: ${result.error.message}`,
        )
        .join('\n')
const renderSyncPass = (output: typeof syncPassSchema.Type): string =>
  `${output.bindingId}: read ${String(output.records)} remote items, created ${String(output.created)}, removed ${String(output.removed)}${output.complete ? '' : ' (more next pass)'}.\n${renderSyncResults(output)}`

const epochMsSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const tzOffsetSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(-840), Schema.isLessThanOrEqualTo(840))
const shippedProjectsSchema = Schema.Array(Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars))))
  .check(Schema.isMaxLength(50))
  .pipe(Schema.optional)
  .annotate({ description: 'Only these absolute project paths; null selects items without a project. Empty or omitted: every project.' })
const shippedPeriodSchema = Schema.Literals(BacklogShipped.periods)
const customRangeIssue = (input: { readonly period: string; readonly from?: number | undefined; readonly to?: number | undefined }): string | undefined => {
  if (input.period !== 'custom') return undefined
  if (input.from === undefined || input.to === undefined) return 'A custom period needs `from` and `to`.'
  return input.from < input.to ? undefined : '`from` must be before `to`.'
}
const shippedInputSchema = Schema.Struct({
  period: shippedPeriodSchema.annotate({
    description: 'Bucket size: `hour`, `day`, `week` (Monday start), `month` or `year` back from now, or `custom` for one `from`–`to` range.',
  }),
  count: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(BacklogShipped.maxCount))
    .pipe(Schema.optional)
    .annotate({ description: 'How many periods, newest first, including the current one; defaults to 24 hours, 14 days, 12 weeks, 12 months or 5 years.' }),
  from: epochMsSchema.pipe(Schema.optional).annotate({ description: 'Custom range start, epoch ms, inclusive. Required with `custom`.' }),
  to: epochMsSchema.pipe(Schema.optional).annotate({ description: 'Custom range end, epoch ms, exclusive. Required with `custom`.' }),
  projects: shippedProjectsSchema,
  tzOffsetMinutes: tzOffsetSchema
    .pipe(Schema.optional)
    .annotate({ description: 'Minutes east of UTC that day, week, month and year boundaries follow; defaults to 0.' }),
}).check(Schema.makeFilter(customRangeIssue))
const shippedSummarySchema = Schema.Struct({
  text: Schema.String,
  generatedAt: epochMsSchema,
  provider: Schema.String,
  model: Schema.String,
  stale: Schema.Boolean,
})
const shippedItemSchema = Schema.Struct({
  id: idSchema,
  ref: refOutputSchema,
  title: Schema.String,
  kind: BacklogItems.kindSchema,
  project: Schema.NullOr(Schema.String),
  doneAt: epochMsSchema,
  doneBy: Schema.String,
  owner: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed('user'))),
  byAgent: Schema.Boolean,
  revisions: Schema.Array(Schema.String),
  pullRequests: Schema.Array(Schema.String),
  /** The final summary written when it closed; a Host that predates summaries answers without. */
  summary: Schema.optionalKey(Schema.String),
})
const shippedOutputSchema = Schema.Struct({
  period: shippedPeriodSchema,
  tzOffsetMinutes: tzOffsetSchema,
  from: epochMsSchema,
  to: epochMsSchema,
  total: nonNegativeCountSchema,
  buckets: Schema.Array(
    Schema.Struct({
      start: epochMsSchema,
      end: epochMsSchema,
      count: nonNegativeCountSchema,
      previousCount: nonNegativeCountSchema,
      projects: Schema.Array(Schema.Struct({ project: Schema.NullOr(Schema.String), items: Schema.Array(shippedItemSchema) })),
      summary: Schema.NullOr(shippedSummarySchema).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
    }),
  ),
})

const renderReadyItems = (output: typeof listOutputSchema.Type): string =>
  output.items.length === 0
    ? 'Nothing is ready: every open item is blocked, has open sub-issues, is claimed or snoozed.'
    : output.items
        .map(
          item =>
            `${BacklogReference.labelOf(item)} ${item.priority === 'none' ? '' : `[${item.priority}] `}${item.title}${item.project === null ? '' : ` · ${item.project}`}`,
        )
        .join('\n')

const renderReady = (output: typeof listOutputSchema.Type): string =>
  `${renderReadyItems(output)}${(output.guidance ?? []).map(entry => `\n\nProject guidance for ${entry.project}:\n${entry.guidance}`).join('')}`

const renderClaim = (result: typeof detailResultSchema.Type): string =>
  result.ok
    ? `${renderItemPreview(result.value.item)}\n${result.value.lease === null ? 'No claim held.' : `Claimed by ${result.value.lease.holder} until ${new Date(result.value.lease.expiresAt).toISOString()}; any write by it renews the claim.`}`
    : 'No backlog item found.'

const writeNote = 'Use it when the user asked, or to record and progress work this thread is doing; never to rewrite items unrelated to the task.'

/** No default: a bare agent request cannot run a guarded write. */
const confirmSchema = Schema.Boolean.pipe(Schema.optional).annotate({ description: AgentConfirmation.confirmDescription })

const peerIdSchema = BacklogPeerWire.idSchema
const peerViewSchema = Schema.Struct({
  runtimeId: peerIdSchema,
  name: Schema.String,
  connected: Schema.Boolean,
  enabled: Schema.Boolean,
  remoteHostId: Schema.NullOr(Schema.String),
  cursor: nonNegativeCountSchema,
  /** Ops the peer holds that this Host has not pulled yet, as of the last pull. */
  lag: nonNegativeCountSchema,
  pulled: nonNegativeCountSchema,
  lastPullAt: Schema.NullOr(epochMsSchema),
  lastSuccessAt: Schema.NullOr(epochMsSchema),
  /** The automation Host the peer reported, so a disagreement between Hosts shows. */
  automationHostId: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.Struct({ code: Schema.String, message: Schema.String })),
})
const peerStatusSchema = Schema.Struct({
  /** Whether `@dshfiles/multi-host` is loaded; without it there are no peers. */
  available: Schema.Boolean,
  hostId: peerIdSchema,
  intervalSeconds: nonNegativeCountSchema,
  /** The Host chosen to run gate checks and main polling, or null for this one. */
  automationHostId: Schema.NullOr(Schema.String),
  /** Whether gate checks and main polling run on this Host. */
  automationHere: Schema.Boolean,
  /** Why automation is skipped here, or what to decide, for the Hosts panel. */
  automationNote: Schema.NullOr(Schema.String),
  peers: Schema.Array(peerViewSchema),
})

/** One backlog every browser and agent shares, owned by the Host. */
export const backlogApi = defineApi({
  id: 'backlog',
  version: 1,
  owner: '@dshfiles/backlog',
  methods: {
    list: method({
      input: listInputSchema,
      output: listOutputSchema,
      description:
        'List or search backlog items (tasks, bugs, ideas, notes, questions), newest activity first. Filter one project with `project` or any of several with `projects`; null selects items without a project. Dormant and archived items are hidden unless `freshness` asks for them. Read-only.',
      tool: { name: 'backlog_list', readOnly: true },
    }),
    revision: method({
      input: Schema.Void,
      output: Schema.Number.check(Schema.isFinite()),
      description:
        'A number that changes whenever any item changes; the panel reads it instead of the lists, again on each `changed` event. Not an agent tool.',
      readOnly: true,
      tags: ['revision'],
    }),
    aiActivity: method({
      input: Schema.Void,
      output: Schema.Struct({ active: Schema.Boolean }),
      description: 'Whether Host-scheduled backlog AI work is currently running. Presentation-only status; not an agent tool.',
      readOnly: true,
    }),
    projects: method({
      /** Optional so a Client older than the agent-item filter still calls it with no input. */
      input: Schema.UndefinedOr(
        Schema.Struct({
          hideAgentItems: Schema.Boolean.pipe(Schema.optional).annotate({
            description: 'Leave out items an agent captured that the user never touched, like the views that hide agent items.',
          }),
        }),
      ),
      output: Schema.Array(
        Schema.Struct({
          project: Schema.NullOr(Schema.String),
          counts: Schema.Struct({
            inbox: Schema.Number.check(Schema.isFinite()),
            todo: Schema.Number.check(Schema.isFinite()),
            doing: Schema.Number.check(Schema.isFinite()),
            done: Schema.Number.check(Schema.isFinite()),
            dropped: Schema.Number.check(Schema.isFinite()),
          }),
          needsYou: nonNegativeCountSchema,
          actors: Schema.Array(Schema.String),
          lastActivityAt: Schema.Number.check(Schema.isFinite()),
        }),
      ),
      description: 'Every project items were captured in, with status counts over all items, how many need the user, and who worked on them. Read-only.',
      tool: { name: 'backlog_projects', readOnly: true },
    }),
    get: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: detailResultSchema,
      description:
        'One backlog item `b:<ref>` with its body, links, event history and the items that link to it. Read-only. Use `backlog_get_many` for several at once.',
      tool: { name: 'backlog_get', readOnly: true, render: renderGetPreview },
    }),
    getMany: method({
      input: Schema.Struct({
        ids: Schema.Array(itemKeySchema).check(Schema.isMinLength(1), Schema.isMaxLength(50)).annotate({
          description:
            'Items as written (`b:k3f9`, `k3f9`, a legacy `b:12`) or their numbers. Duplicates are read once; unknown ones are reported, not failed.',
        }),
      }),
      output: detailManySchema,
      description:
        'Several backlog items in one call, each with its body, links, event history and backlinks, in the order asked; ids that do not exist come back in `missing`. Read-only. Prefer it over repeated `backlog_get` calls.',
      tool: { name: 'backlog_get_many', readOnly: true },
    }),
    referencing: method({
      input: BacklogItems.linkSchema,
      output: Schema.Array(summarySchema),
      description: 'Backlog items that link to a target: a thread (session id), a jj revision, a branch, a workspace, a URL or another item. Read-only.',
      tool: { name: 'backlog_referencing', readOnly: true },
    }),
    capture: method({
      input: Schema.Struct({
        text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxBodyChars)).annotate({
          description:
            'Free text. First line is the title; a `bug:`/`idea:`/`note:`/`question:`/`task:` prefix sets the kind; `!1` (urgent) to `!4` (low) sets the priority; `#tags`, `b:<ref>`, `jj:<rev>`, `branch:<name>`, session ids and URLs become links.',
        }),
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: "Absolute project path; an agent's working directory by default." }),
        status: BacklogItems.statusSchema.pipe(Schema.optional).annotate({ description: 'Defaults to `inbox`.' }),
        kind: BacklogItems.kindSchema.pipe(Schema.optional).annotate({ description: 'Overrides the kind the text prefix would derive.' }),
        priority: BacklogItems.prioritySchema
          .pipe(Schema.optional)
          .annotate({ description: 'urgent, high, medium, low or none; overrides a `!1`…`!4` written in the text.' }),
        parent: refTextSchema.pipe(Schema.optional).annotate({ description: 'Capture it as a sub-issue of this item (`b:k3f9`); three levels deep at most.' }),
        due: DueDates.schema.pipe(Schema.optional).annotate({ description: 'The date it is due, YYYY-MM-DD with no time.' }),
        template: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)).pipe(Schema.optional).annotate({
          description:
            'Start from a template in Backlog settings (by name, such as `Bug report`): it adds its title prefix, kind, priority, tags, body and acceptance criteria where the capture left them out. `/template <name>` in the text does the same.',
        }),
        recurrence: Recurrence.schema
          .pipe(Schema.optional)
          .annotate({ description: '`daily`, `weekly`, `monthly` or `cron:<expr>`: finishing it creates the next occurrence.' }),
        files: Schema.Array(fileInputSchema)
          .check(Schema.isMaxLength(BacklogItems.maxAttachments))
          .pipe(Schema.optional)
          .annotate({ description: 'Files to keep with the item: base64 `data` without a data-URL prefix, with kind, name, media type and byte size.' }),
      }),
      output: detailSchema,
      description: `Add one item to the backlog; the calling thread is linked to it. ${writeNote}`,
      tool: { name: 'backlog_capture', readOnly: false, render: renderCreatedPreview },
    }),
    attachFile: method({
      input: Schema.Struct({ id: itemKeySchema, file: fileInputSchema }),
      output: detailResultSchema,
      description: `Keep one image or file with an existing backlog item. ${writeNote}`,
      tool: { name: 'backlog_attach_file', readOnly: false, render: renderDetailPreview },
    }),
    readFile: method({
      input: Schema.Struct({
        id: itemKeySchema,
        attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
        save: Schema.Boolean.pipe(Schema.optional).annotate({
          description: 'Also write the bytes to a temporary file and return its absolute path, for an image or file reader that needs a path.',
        }),
      }),
      output: fileOutputSchema,
      description: 'Read one image or file kept with a backlog item as a data URL, optionally also written to a temporary file. Read-only.',
      tool: { name: 'backlog_read_file', readOnly: true },
    }),
    removeFile: method({
      input: Schema.Struct({ id: itemKeySchema, attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)) }),
      output: detailResultSchema,
      description: `Remove one image or file from a backlog item. ${writeNote}`,
      tool: { name: 'backlog_remove_file', readOnly: false, render: renderDetailPreview },
    }),
    delete: method({
      input: Schema.Struct({
        id: itemKeySchema,
        confirm: Schema.Literal(true).annotate({ description: 'Explicit opt-in acknowledging this permanently deletes the item and its attachments.' }),
      }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true) }), Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('not-found') })]),
      description:
        'Permanently delete a backlog item, its attachments and its remote-issue link (the remote issue itself stays). This cannot be undone; use it only when the user explicitly asked for deletion and pass confirm: true. Use it when the user asked, never to rewrite items unrelated to the task.',
      tool: { name: 'backlog_delete', readOnly: false },
    }),
    speechStatus: method({
      input: Schema.Void,
      output: speechStatusSchema,
      description: 'Whether the Host voice-input bundle can transcribe right now, with the selected provider and language. Not an agent tool.',
    }),
    jevSetupStatus: method({
      input: Schema.Void,
      output: jevSetupStatusSchema,
      description:
        'Whether enabled Backlog Jev lacks a resolvable key, returning setup state only and never any credential. Presentation-only status for the inline setup offer.',
    }),
    classifyReply: method({
      input: Schema.Struct({ text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxBodyChars)) }),
      output: replyRouteSchema,
      description:
        'Classify one submitted item reply as discussion or a separate work thread. Uses Jev when configured and keyword fallback otherwise; presentation-only.',
    }),
    generateReply: method({
      input: Schema.Struct({
        id: itemKeySchema,
        text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxBodyChars)),
        provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
      }),
      output: detailResultSchema,
      description: 'Generate and save a concise AI answer to a reply-worthy item message using the configured agent policy. Presentation-only.',
    }),
    transcribeSpeech: method({
      input: Schema.Struct({ audioBase64: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(24_000_000)) }),
      output: transcriptionSchema,
      description: 'Transcribe one browser microphone recording through the Host voice-input bundle. Not an agent tool.',
    }),
    enrichTweet: method({
      input: Schema.Struct({ id: itemKeySchema, url: BacklogItems.tweetContextUrlSchema }),
      output: detailResultSchema,
      description: `Retrieve public tweet text and media for a URL already in one backlog item. Use it when the user asked; this sends the post ID to FxEmbed and appends quoted, untrusted tweet text plus available images without replacing the existing description.`,
      tool: { name: 'backlog_enrich_tweet', readOnly: false, render: renderDetailPreview },
    }),
    update: method({
      input: Schema.Struct({
        id: itemKeySchema,
        title: Schema.String.check(Schema.isMaxLength(BacklogItems.maxTitleChars)).pipe(Schema.optional),
        body: Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars)).pipe(Schema.optional),
        kind: BacklogItems.kindSchema.pipe(Schema.optional),
        status: BacklogItems.statusSchema
          .pipe(Schema.optional)
          .annotate({ description: 'Move the item; `dropped` closes it without doing it. Nothing is ever deleted.' }),
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars))).pipe(Schema.optional),
        tags: Schema.Array(Schema.String.check(Schema.isMaxLength(60)))
          .check(Schema.isMaxLength(20))
          .pipe(Schema.optional),
        pinned: Schema.Boolean.pipe(Schema.optional),
        attention: BacklogItems.attentionSchema.pipe(Schema.optional).annotate({
          description:
            '`needs-input` asks the user for a decision, `blocked` and `waiting` flag stalled work; `none` clears it. Pair it with a comment saying what is needed.',
        }),
        snoozedUntil: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)))
          .pipe(Schema.optional)
          .annotate({ description: 'Hide the item until this epoch-ms time; null wakes it.' }),
        priority: BacklogItems.prioritySchema.pipe(Schema.optional).annotate({ description: 'urgent, high, medium, low, or none to clear it.' }),
        parent: Schema.NullOr(refTextSchema).pipe(Schema.optional).annotate({
          description: 'Nest it under this item (`b:k3f9`) as a sub-issue, or null to make it top-level. Refused for itself, a loop, or a fourth level.',
        }),
        criteria: Schema.NullOr(Schema.Array(criterionInputSchema).check(Schema.isMaxLength(BacklogItems.maxCriteria)))
          .pipe(Schema.optional)
          .annotate({
            description:
              'Acceptance criteria, replacing the whole list ({text, done?, id?}); a criterion with the same text keeps its id and check. null removes them.',
          }),
        criteriaChecks: Schema.Array(Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)), done: Schema.Boolean }))
          .check(Schema.isMaxLength(BacklogItems.maxCriteria))
          .pipe(Schema.optional)
          .annotate({ description: 'Check (done: true) or uncheck criteria by their id, as backlog_get returns them, without rewriting the list.' }),
        plan: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'How the work will be done (markdown); null or empty removes it.' }),
        planApproval: Schema.NullOr(BacklogItems.planApprovalSchema).pipe(Schema.optional).annotate({
          description:
            '`pending` asks the user to approve the plan before you start: the item asks for input until they approve. Only the user can set `approved`; wait for it.',
        }),
        due: Schema.NullOr(DueDates.schema)
          .pipe(Schema.optional)
          .annotate({ description: 'The date it is due, YYYY-MM-DD with no time, or null to clear it. Open items past it show as overdue in the Inbox.' }),
        gates: Schema.NullOr(
          Schema.Array(
            Schema.Struct({ kind: Schema.Literals(BacklogGates.kinds), target: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)) }),
          ).check(Schema.isMaxLength(BacklogGates.max)),
        )
          .pipe(Schema.optional)
          .annotate({
            description:
              'Outside conditions it waits on, replacing the list: `pr` (a pull request URL, open until merged), `revision` (a jj change or commit id, open until it is on main), `check` (a project-check action id, open until it passes in a thread linked to the item), `date` (YYYY-MM-DD, open until that day). The item is not ready while a gate is open; gates resolve on their own. null removes them.',
          }),
        recurrence: Schema.NullOr(Recurrence.schema).pipe(Schema.optional).annotate({
          description:
            '`daily`, `weekly`, `monthly` or `cron:<min hour dom month dow>`: when the item is done the Host creates the next occurrence with the next due date (criteria unchecked). null stops repeating.',
        }),
        summary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'Final summary of what was done, written when closing the item; Shipped shows it.' }),
      }),
      output: detailResultSchema,
      description: `Edit or move one backlog item, or ask the user for input with \`attention\`. Structured sections: \`criteria\` (acceptance checklist), \`plan\` (with \`planApproval: pending\` to wait for the user's go-ahead) and \`summary\` (when closing). ${writeNote}`,
      tool: { name: 'backlog_update', readOnly: false, render: renderDetailPreview },
    }),
    ready: method({
      input: Schema.Struct({
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'Absolute project path; null lists ready items outside any project. Omit for every project.' }),
        limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(200))
          .pipe(Schema.optional)
          .annotate({ description: 'How many to return; defaults to 20.' }),
      }),
      output: listOutputSchema,
      description:
        'The ready queue: open (inbox or todo) items nothing open blocks (`depends-on`/`blocks` links), with no open sub-issue, not snoozed and not claimed, urgent first then oldest. Pick the first and claim it with backlog_claim before working on it. Read-only.',
      tool: { name: 'backlog_ready', readOnly: true, render: renderReady },
    }),
    claim: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: detailResultSchema,
      description: `Claim one item for this thread before working on it: you become its delegate, it moves to \`doing\`, this thread is linked and a lease starts. Refused while another agent holds a live claim (the error names it) and for closed items. Any write you make to the item renews the lease; it ends after the idle time in Backlog settings, when this thread is archived or settled, when the item is done, or with backlog_release. ${writeNote}`,
      tool: { name: 'backlog_claim', readOnly: false, render: renderClaim },
    }),
    release: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: detailResultSchema,
      description: `Give up a claim without finishing: the lease ends, the delegate is cleared and an item still \`doing\` returns to \`todo\` so it is ready again. Only the holder may release a live claim; the user can release any from the panel. Say in a backlog_comment what is left. ${writeNote}`,
      tool: { name: 'backlog_release', readOnly: false, render: renderDetailPreview },
    }),
    link: method({
      input: Schema.Struct({ id: itemKeySchema, link: BacklogItems.linkSchema, remove: Schema.Boolean.pipe(Schema.optional) }),
      output: detailResultSchema,
      description: `Link a backlog item to a thread, jj revision, branch, workspace, URL or another item (\`remove: true\` unlinks). ${writeNote}`,
      tool: { name: 'backlog_link', readOnly: false, render: renderDetailPreview },
    }),
    agentContinuationCandidates: method({
      input: Schema.Struct({ id: itemKeySchema, handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)) }),
      output: Schema.Array(agentContinuationCandidateSchema).check(Schema.isMaxLength(50)),
      description: 'List threads for an agent that are already linked to one backlog item, for an explicit continue-or-new choice.',
    }),
    continueAgentThread: method({
      input: Schema.Struct({
        id: itemKeySchema,
        handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
        sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
        text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxBodyChars)),
      }),
      output: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)), queued: Schema.Literal(true) }),
      description: 'Validate one linked thread belongs to the mentioned agent and queue the task into it.',
    }),
    startThread: method({
      input: Schema.Struct({
        ids: Schema.Array(itemKeySchema)
          .check(Schema.isMinLength(1), Schema.isMaxLength(20))
          .annotate({ description: 'The items the thread works on; every one of them is linked and named in the opening message.' }),
        workspaceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
          .pipe(Schema.optional)
          .annotate({ description: 'Registered project to cut the thread its own jj workspace from. Exclusive with `cwd`.' }),
        cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars))
          .pipe(Schema.optional)
          .annotate({ description: 'Bare folder to run the thread in when it is not a registered project. Exclusive with `workspaceId`.' }),
        agent: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80))
          .pipe(Schema.optional)
          .annotate({ description: 'Agent handle (no `@`) whose preset, model route and instructions start the thread.' }),
        provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))
          .pipe(Schema.optional)
          .annotate({ description: 'Account route for the thread when no agent is named.' }),
        model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
          .pipe(Schema.optional)
          .annotate({ description: 'Model on that provider when no agent is named.' }),
        reasoningEffort: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60))
          .pipe(Schema.optional)
          .annotate({ description: 'Effort for that model, when its adapter advertises one.' }),
        message: Schema.String.check(Schema.isMaxLength(4_000)).pipe(Schema.optional).annotate({
          description:
            "The thread's first message; the items' own headings by default. An agent's identity and instructions are prepended when `agent` is named.",
        }),
      }),
      output: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)), linked: Schema.Array(idSchema), missing: Schema.Array(itemKeySchema) }),
      description: `Start one thread for these items: it runs in its own jj workspace of their project, is named after the first item, receives every selected item's full description, all current replies in order, and every item- and reply-level attachment, and links to every item. Missing or unreadable items/files and upload or prompt failures reject the start instead of silently omitting context. ${writeNote}`,
      tool: { name: 'backlog_start_thread', readOnly: false },
    }),
    syncStatus: method({
      input: Schema.Struct({
        ids: Schema.Array(itemKeySchema)
          .check(Schema.isMaxLength(500))
          .pipe(Schema.optional)
          .annotate({ description: 'Only these items; omit for every linked item.' }),
      }),
      output: syncStatusSchema,
      description:
        'Remote sync of backlog items: the providers, connections (accounts) and bindings (sync flows), and each linked item with its binding, remote key, sync state (synced, pending, conflict, error), last sync time, last error and recent conflicts. Read-only.',
      tool: { name: 'backlog_sync_status', readOnly: true },
    }),
    syncNow: method({
      input: Schema.Struct({
        id: itemKeySchema.pipe(Schema.optional).annotate({ description: 'One linked item; omit to sync every linked item (of `project`, when given).' }),
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'Only linked items of this project; null selects items without a project.' }),
        binding: slugInputSchema
          .pipe(Schema.optional)
          .annotate({ description: 'Run one binding: pull what changed remotely since its last pass, then push local changes of its linked items.' }),
        confirm: confirmSchema,
      }),
      output: Schema.Struct({ results: Schema.Array(syncResultSchema), passes: Schema.optionalKey(Schema.Array(syncPassSchema)) }),
      description: `Sync linked backlog items with their remote items now: each binding's field map decides which fields flow which way (a field both sides changed is settled by the binding's conflict policy, with a conflict note on the item), and new comments are carried over once. Run only when the user asked. Without \`id\` it syncs every linked item or a whole binding, which an agent may run only with \`confirm: true\`. ${writeNote}`,
      tool: { name: 'backlog_sync_now', readOnly: false, render: renderSyncResults },
    }),
    linkRemote: method({
      input: Schema.Struct({
        id: itemKeySchema,
        binding: slugInputSchema
          .pipe(Schema.optional)
          .annotate({ description: 'The binding to link through; omit to use the one serving the item’s project.' }),
        backend: providerKindInputSchema.pipe(Schema.optional).annotate({
          description: 'Provider kind (linear, github, files…) when no binding is named; omit to read it from the reference.',
        }),
        reference: remoteReferenceSchema.pipe(Schema.optional),
        create: Schema.Boolean.pipe(Schema.optional).annotate({
          description: 'Create a new remote item from the backlog item through the binding instead of linking `reference`.',
        }),
        remove: Schema.Boolean.pipe(Schema.optional).annotate({
          description: 'Unlink the item (from `binding`, from every binding of `backend`, or from all) and stop syncing it; neither side is deleted.',
        }),
      }).check(
        Schema.makeFilter(input =>
          input.remove === true || input.create === true || (input.reference ?? '') !== '' ? undefined : 'Pass `reference`, `create: true` or `remove: true`.',
        ),
      ),
      output: Schema.Struct({ item: Schema.NullOr(syncItemSchema), result: Schema.NullOr(syncResultSchema) }),
      description: `Link one backlog item to a remote item through a binding (adopting its fields on the first sync, tags merged), create a new remote item from it, or unlink it with \`remove: true\`. An item may be linked through several bindings, one remote item each. The remote URL is added to the item's links. Run only when the user asked; it writes to the remote tracker. ${writeNote}`,
      tool: { name: 'backlog_link_remote', readOnly: false },
    }),
    syncSources: method({
      input: Schema.Struct({}),
      output: syncSourcesSchema,
      description:
        'The sync providers, connections (accounts, with where each key comes from, never the key) and bindings (container, project scope, direction, field map, conflict policy, poll interval, owner Host). Read-only.',
      tool: { name: 'backlog_sync_connections', readOnly: true, render: renderSyncSources },
    }),
    saveSyncConnection: method({
      input: Schema.Struct({
        connection: connectionInputSchema,
        previousInstanceId: slugInputSchema.pipe(Schema.optional).annotate({ description: 'The id the connection had, to rename it; its bindings follow.' }),
      }),
      output: syncConnectionViewSchema,
      description: `Add or change one sync connection (an account of a provider). The key is stored only as a secret:ALIAS reference. Run only when the user asked for this change. ${writeNote}`,
      tool: { name: 'backlog_sync_connection_save', readOnly: false },
    }),
    removeSyncConnection: method({
      input: Schema.Struct({ instanceId: slugInputSchema, confirm: confirmSchema }),
      output: Schema.Void,
      description:
        'Remove one sync connection with its bindings and every item link they hold; items and remote items stay. Run only when the user asked; an agent must pass `confirm: true`.',
      tool: { name: 'backlog_sync_connection_remove', readOnly: false },
    }),
    moveSyncConnection: method({
      input: Schema.Struct({ instanceId: slugInputSchema, direction: Schema.Literals(['earlier', 'later']) }),
      output: Schema.Void,
      description: 'Move one sync connection earlier or later in the list. Run only when the user asked for that order.',
      tool: { name: 'backlog_sync_connection_move', readOnly: false },
    }),
    saveSyncBinding: method({
      input: Schema.Struct({ binding: bindingInputSchema }),
      output: syncBindingViewSchema,
      description: `Add or change one sync binding: which container of which connection syncs with which projects, in which direction, which fields (with value maps), under which conflict policy (lww, local-wins, remote-wins, flag), how often, and whether a pull imports new remote items. A new binding needs \`connectionId\`; fields left out of a change keep their value. Run only when the user asked for this change. ${writeNote}`,
      tool: { name: 'backlog_sync_binding_save', readOnly: false },
    }),
    removeSyncBinding: method({
      input: Schema.Struct({ binding: slugInputSchema, confirm: confirmSchema }),
      output: Schema.Void,
      description:
        'Remove one sync binding and every item link it holds; items and remote items stay. Run only when the user asked; an agent must pass `confirm: true`.',
      tool: { name: 'backlog_sync_binding_remove', readOnly: false },
    }),
    discoverSync: method({
      input: connectionTargetSchema,
      output: syncConnectionSchema,
      description:
        'List the containers (teams, repositories, folders) a connection can bind, with the account it signs in as. The key never leaves the Host. Read-only.',
      tool: { name: 'backlog_sync_discover', readOnly: true, render: renderSyncConnection },
    }),
    testSyncConnection: method({
      input: connectionTargetSchema,
      output: syncConnectionSchema,
      description:
        'Test one sync connection (saved or not) on the Host: where its key comes from, the account it signs in as and the containers it can see. The key never leaves the Host. Read-only.',
      tool: { name: 'backlog_sync_test_connection', readOnly: true, render: renderSyncConnection },
    }),
    testSyncConnections: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ results: Schema.Array(Schema.Struct({ connection: BacklogSyncModel.connectionSchema, report: syncConnectionSchema })) }),
      description:
        'Test every saved sync connection on the Host (the Test all button), with the same report as backlog_sync_test_connection. The keys never leave the Host. Read-only.',
      tool: { name: 'backlog_sync_test_all', readOnly: true, render: renderSavedSyncConnections },
    }),
    importRemote: method({
      input: Schema.Struct({
        backend: providerKindInputSchema.pipe(Schema.optional).annotate({
          description:
            'Provider kind of the remote item; omit to read it from the reference (ENG-12 or linear.app is Linear; #42, owner/repo#42 or github.com is GitHub).',
        }),
        binding: slugInputSchema.pipe(Schema.optional).annotate({ description: 'The binding to import through; omit to use the one serving `project`.' }),
        reference: remoteReferenceSchema,
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'Project the new item belongs to; defaults to the binding’s project.' }),
      }),
      output: Schema.Struct({ detail: detailSchema, created: Schema.Boolean }),
      description: `Import one existing remote item as a new backlog item linked to it, with its title, description, status, labels, priority and comments; a remote item already linked through that binding returns its item. Run only when the user asked. ${writeNote}`,
      tool: { name: 'backlog_import_remote', readOnly: false, render: output => renderItemPreview(output.detail.item) },
    }),
    importAllRemote: method({
      input: Schema.Struct({ binding: slugInputSchema, confirm: confirmSchema }),
      output: syncPassSchema,
      description: `Import every open remote item of a binding that no backlog item mirrors yet, idempotently (already linked ones only sync). Comments come on each item's next sync. Run only when the user asked; an agent must pass \`confirm: true\`. ${writeNote}`,
      tool: { name: 'backlog_sync_import_all', readOnly: false, render: renderSyncPass },
    }),
    acknowledge: method({
      input: Schema.Struct({ ids: Schema.Array(itemKeySchema).check(Schema.isMaxLength(500)) }),
      output: Schema.Void,
      description: 'Mark Inbox items as seen by the user. Presentation state for the panel; not an agent tool.',
    }),
    triage: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: detailResultSchema,
      description:
        'Run automatic triage on one item now (Jev and the configured cheap model). A confident answer applies, skipping fields the user set by hand; otherwise it is left as a proposal on the item.',
      tool: { name: 'backlog_triage', readOnly: false, render: renderDetailPreview },
    }),
    backfillTriage: method({
      input: Schema.Struct({
        limit: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))
          .pipe(Schema.optional)
          .annotate({ description: 'How many inbox/todo tasks one run may triage, oldest first; defaults to 25.' }),
        retriage: Schema.Boolean.pipe(Schema.optional).annotate({
          description: 'Also re-triage inbox/todo tasks already looked at, e.g. after changing the prompt or model.',
        }),
        confirm: confirmSchema,
      }),
      output: backfillOutputSchema,
      description: `Start a background triage backfill for inbox/todo tasks only (Jev and the configured cheap model). Returns a job id immediately; check backlog_triage_backfill_status to follow progress. A confident answer applies; a hesitant one waits on the item as a suggestion. Run only when the user asked: an agent run over more than ${String(AgentConfirmation.bulkLimit)} items (the default is ${String(BacklogBackfill.defaultLimit)}) needs \`confirm: true\`. ${writeNote}`,
      tool: { name: 'backlog_triage_backfill', readOnly: false },
    }),
    backfillTriageStatus: method({
      input: Schema.Struct({ jobId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)) }),
      output: Schema.NullOr(backfillOutputSchema),
      description: 'Read progress for one backlog triage backfill job by its returned job id.',
      tool: { name: 'backlog_triage_backfill_status', readOnly: true },
    }),
    applyProposal: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: detailResultSchema,
      description: `Accept the triage proposal on an item: its kind, status, title and tags apply, and a suspected duplicate is linked. ${writeNote}`,
      tool: { name: 'backlog_accept_proposal', readOnly: false, render: renderDetailPreview },
    }),
    dismissProposal: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: detailResultSchema,
      description: `Dismiss the triage proposal on an item without changing it. ${writeNote}`,
      tool: { name: 'backlog_dismiss_proposal', readOnly: false, render: renderDetailPreview },
    }),
    comment: method({
      input: commentInputSchema,
      output: detailResultSchema,
      description: `Add a progress comment to a backlog item with text or attachments; references in the text become links. ${writeNote}`,
      tool: { name: 'backlog_comment', readOnly: false, render: renderDetailPreview },
    }),
    editComment: method({
      input: Schema.Struct({
        id: itemKeySchema,
        commentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        text: Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars)),
        files: Schema.Array(fileInputSchema)
          .check(Schema.isMaxLength(BacklogItems.maxAttachments))
          .pipe(Schema.optional)
          .annotate({ description: 'Replacement images or files; omit to preserve the existing attachments, or pass an empty list to remove them.' }),
      }).check(Schema.makeFilter(input => (commentHasBody(input) ? undefined : 'A reply needs text or at least one attachment.'))),
      output: detailResultSchema,
      description: 'Edit one of the current user’s previous replies in the backlog panel.',
    }),
    revert: method({
      input: Schema.Struct({
        id: itemKeySchema,
        at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)).annotate({
          description: 'The `at` time of the item event whose `fieldChanges` lists the change to undo, as `backlog_get` returns it.',
        }),
        field: BacklogItems.humanFieldSchema.annotate({
          description:
            'The changed field to put back: title, body, kind, status, project, tags, pinned, attention, priority, parent, criteria, plan, planApproval or summary.',
        }),
        confirm: confirmSchema,
      }),
      output: revertResultSchema,
      description:
        'Revert one recorded field change of a backlog item: writes the typed value the field held before that change, read from the op log, as a new change. Refused with `stale` when the field changed again since. Run only when the user asked to revert that change, and pass `confirm: true`; an agent call without it is refused.',
      tool: { name: 'backlog_revert', readOnly: false, render: renderRevertPreview },
    }),
    setProjectGuidance: method({
      input: Schema.Struct({
        project: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars)).annotate({
          description: 'Absolute project path.',
        }),
        guidance: Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars)).annotate({
          description: 'Markdown instructions for agents working on this project’s items; empty removes them.',
        }),
      }),
      output: Schema.Struct({ project: Schema.String, guidance: Schema.NullOr(Schema.String) }),
      description:
        'Set one project’s standing guidance for agents: it opens the first message of threads started from its items and comes back with backlog_get and backlog_ready. Run only when the user asked for this change.',
      tool: { name: 'backlog_set_project_guidance', readOnly: false },
    }),
    scheduleRule: method({
      input: Schema.Struct({
        rule: Schema.Literals(['triage', 'recreate']).annotate({
          description: '`triage`: triage the project inbox on each run. `recreate`: capture a fresh copy of the item `id` on each run.',
        }),
        project: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars))
          .pipe(Schema.optional)
          .annotate({ description: 'Absolute project path; defaults to the project of `id`.' }),
        id: itemKeySchema.pipe(Schema.optional).annotate({ description: 'The item a `recreate` rule copies.' }),
        timing: timingSchema.annotate({
          description: 'When it runs: { kind: daily, time, timeZone }, weekly with weekdays, cron with an expression, or every N seconds.',
        }),
      }),
      output: Schema.Struct({
        automationId: Schema.String,
        title: Schema.String,
        schedule: Schema.NullOr(Schema.String),
        projectTitle: Schema.NullOr(Schema.String),
      }),
      description:
        'Schedule a backlog rule as a project automation (via @dshfiles/project-automations): each run starts a thread in the project whose prompt calls backlog tools. For an item that simply repeats, prefer its `recurrence` field. Run only when the user asked; manage or delete the automation with automation_list / automation_delete.',
      tool: {
        name: 'backlog_schedule_rule',
        readOnly: false,
        render: output => `Scheduled "${output.title}"${output.schedule === null ? '' : ` (${output.schedule})`} as automation ${output.automationId}.`,
      },
    }),
    pullRequests: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: pullRequestsOutputSchema,
      description:
        'The pull requests an item links (URL links and PR gates) with their live state (open, merged, closed) and checks, read from the pull-requests plugin. A PR no thread watches shows `unknown`; `available: false` when that plugin is not loaded. Read-only.',
      tool: { name: 'backlog_pull_requests', readOnly: true, render: renderPullRequests },
    }),
    linkPullRequest: method({
      input: Schema.Struct({
        id: itemKeySchema,
        url: pullRequestUrlSchema.annotate({ description: 'A GitHub pull request or GitLab merge request URL.' }),
        closes: Schema.Boolean.pipe(Schema.optional).annotate({
          description: 'The PR resolves the item (default true): merging it moves the item to done, unless its status was set by hand.',
        }),
        gate: Schema.Boolean.pipe(Schema.optional).annotate({ description: 'Also wait on it: the item is not ready until the PR merges.' }),
      }),
      output: detailResultSchema,
      description: `Link a pull request to an item as a first-class PR link: its state and checks show on the item (watched through the newest thread linked to the item), and merging it closes the item when \`closes\` is on. ${writeNote}`,
      tool: { name: 'backlog_link_pr', readOnly: false, render: renderDetailPreview },
    }),
    merge: method({
      input: Schema.Struct({
        survivor: itemKeySchema.annotate({ description: 'The item that stays (`b:k3f9`).' }),
        duplicates: Schema.Array(itemKeySchema)
          .check(Schema.isMinLength(1), Schema.isMaxLength(10))
          .annotate({ description: 'The duplicates to merge into it; each is dropped with a `duplicates` link and its `b:<ref>` then opens the survivor.' }),
        confirm: confirmSchema,
      }),
      output: mergeResultSchema,
      description:
        "Merge duplicate items into one: their comments (quoted, keeping who wrote them), links, tags, files, sub-issues and remote links where the survivor has none for that binding move to the survivor, links from other items are rewritten to it, and each duplicate is dropped with a `duplicates` link. `b:<duplicate>` references keep working and open the survivor. Every step is in both items' history. Run only when the user asked; an agent must pass `confirm: true`.",
      tool: {
        name: 'backlog_merge',
        readOnly: false,
        render: result =>
          result.ok ? `${renderItemPreview(result.value.item)}\nMerged ${result.merged.map(ref => `b:${ref}`).join(', ')} into it.` : 'No backlog item found.',
      },
    }),
    export: method({
      input: Schema.Struct({
        path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_024)).annotate({
          description: 'Absolute path of a new file on the Host, such as /Users/you/backlog.jsonl; an existing file is never overwritten.',
        }),
        format: Schema.Literals(['jsonl', 'sqlite']).annotate({
          description: '`jsonl`: one folded item per line. `sqlite`: a consistent copy of the whole backlog database.',
        }),
        includeOps: Schema.Boolean.pipe(Schema.optional).annotate({ description: 'JSONL only: also write every op of the log, after the items.' }),
      }),
      output: Schema.Struct({
        path: Schema.String,
        format: Schema.Literals(['jsonl', 'sqlite']),
        items: nonNegativeCountSchema,
        ops: nonNegativeCountSchema,
        bytes: nonNegativeCountSchema,
      }),
      description:
        'Export the backlog to a new file on the Host: JSONL (one folded item per line, optionally followed by every op) or an SQLite copy. Changes no item; it writes the file the user asked for, so run it only when the user asked for an export.',
      tool: {
        name: 'backlog_export',
        readOnly: false,
        render: output =>
          `Exported ${String(output.items)} items${output.format === 'jsonl' && output.ops > 0 ? ` and ${String(output.ops)} ops` : ''} to ${output.path} (${String(output.bytes)} bytes).`,
      },
    }),
    shipped: method({
      input: shippedInputSchema,
      output: shippedOutputSchema,
      description:
        "What shipped: items that reached `done` per hour, day, week, month or year (or one custom range), newest period first, grouped by project, with each item's linked revisions and pull requests, the previous period's count for the delta, and any cached AI summary. Only items done now count, once, at their last move to done; dropped items never count; agent-captured items count and say so. Read-only.",
      tool: { name: 'backlog_shipped', readOnly: true, render: BacklogShipped.render },
    }),
    summarizeShipped: method({
      input: Schema.Struct({
        period: shippedPeriodSchema,
        start: epochMsSchema.annotate({ description: 'The bucket `start` as `backlog_shipped` returns it.' }),
        end: epochMsSchema.annotate({ description: 'The bucket `end` as `backlog_shipped` returns it.' }),
        projects: shippedProjectsSchema,
        regenerate: Schema.Boolean.pipe(Schema.optional).annotate({ description: 'Call the model again even when a current summary is cached.' }),
      }).check(Schema.makeFilter(input => (input.start < input.end ? undefined : '`start` must be before `end`.'))),
      output: Schema.Struct({ ...shippedSummarySchema.fields, cached: Schema.Boolean }),
      description:
        'A short AI summary of one shipped period, written by the configured triage model (Backlog settings › Triage) and cached per period, bucket and project filter; a cached summary whose items are unchanged is returned without a model call. Changes no item, but calls the model, so run it only when the user asked for a summary.',
      tool: { name: 'backlog_summarize_shipped', readOnly: false, render: output => output.text },
    }),
    deleteComment: method({
      input: Schema.Struct({ id: itemKeySchema, commentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)) }),
      output: detailResultSchema,
      description: 'Delete one of the current user’s previous replies in the backlog panel.',
    }),
    peerInfo: method({
      input: Schema.Void,
      output: BacklogPeerWire.infoSchema,
      description: 'Who this backlog Host is for a peer Host: its id, peer protocol, op and storage schema versions, and automation Host. Not an agent tool.',
    }),
    peerOpsSince: method({
      input: Schema.Struct({
        cursor: nonNegativeCountSchema,
        limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(2_000)).pipe(Schema.optional),
      }),
      output: BacklogPeerWire.opsPageSchema,
      description:
        'Ops this Host stored after `cursor`, in its own storing order, every op it holds whatever Host wrote it: what a peer Host pulls to replicate the backlog. Bounded in count and size; `more` says another page waits. Not an agent tool.',
    }),
    peerFiles: method({
      input: BacklogPeerWire.filesInputSchema,
      output: BacklogPeerWire.filesOutputSchema,
      description: 'The stored bytes of attachments a peer Host lacks, by item id and attachment id, with their SHA-256; bounded per call. Not an agent tool.',
    }),
    peerStatus: method({
      input: Schema.Void,
      output: peerStatusSchema,
      description:
        'Backlog replication across Hosts: the multi-host runtimes this Host can pull the backlog from, whether each is on, how far it was pulled, the ops still to pull, its last error, and which Host runs gate checks and main polling. Read-only.',
      tool: { name: 'backlog_peer_status', readOnly: true },
    }),
    peerSync: method({
      input: Schema.Struct({
        runtimeId: peerIdSchema.pipe(Schema.optional).annotate({ description: 'One runtime to pull now; omit to pull every enabled one.' }),
      }),
      output: peerStatusSchema,
      description:
        'Pull backlog changes from enabled peer Hosts now instead of at the next interval, then return the replication status. It adds the peers’ ops to this backlog; run it only when the user asked to sync.',
      tool: { name: 'backlog_peer_sync', readOnly: false },
    }),
    configurePeers: method({
      input: Schema.Struct({
        peers: Schema.Array(Schema.Struct({ runtimeId: peerIdSchema, enabled: Schema.Boolean }))
          .pipe(Schema.optional)
          .annotate({
            description:
              'Runtimes to turn backlog replication on or off for; others keep their setting. Turning one off stops pulling and keeps what was pulled.',
          }),
        automationHost: Schema.String.check(Schema.isMaxLength(128)).pipe(Schema.optional).annotate({
          description: 'The backlog Host id (from `backlog_peer_status`) that runs gate checks and main polling; an empty string means this Host.',
        }),
      }),
      output: peerStatusSchema,
      description:
        'Turn backlog replication on or off per multi-host runtime and choose the Host that runs gate checks and main polling. It changes Backlog settings; run it only when the user asked.',
      tool: { name: 'backlog_peers_configure', readOnly: false },
    }),
    eventHosts: method({
      input: Schema.Struct({ id: itemKeySchema }),
      output: Schema.Struct({ events: Schema.Array(Schema.Struct({ at: epochMsSchema, actor: Schema.String, host: Schema.String })) }),
      description: "Which other Host wrote each of an item's events, for its work log; events this Host wrote are left out. Not an agent tool.",
    }),
  },
  events: {
    changed: event({
      schema: Schema.Struct({ revision: Schema.Number.check(Schema.isFinite()) }),
      description: 'The backlog revision moved: an item was written, deleted or pulled from a peer.',
      invalidates: ['revision'],
    }),
  },
})

export type BacklogSummaryView = typeof summarySchema.Type
export type BacklogDetailView = typeof detailSchema.Type
export type BacklogListView = typeof listOutputSchema.Type
export type BacklogDetailResult = typeof detailResultSchema.Type
export type BacklogRevertResult = typeof revertResultSchema.Type
export type BacklogMergeResult = typeof mergeResultSchema.Type
export type BacklogBackfillResult = typeof backfillOutputSchema.Type
export type BacklogSyncStatusView = typeof syncStatusSchema.Type
export type BacklogSyncSourcesView = typeof syncSourcesSchema.Type
export type BacklogSyncConnectionView = typeof syncConnectionViewSchema.Type
export type BacklogSyncBindingView = typeof syncBindingViewSchema.Type
export type BacklogSyncTestView = typeof syncConnectionSchema.Type
export type BacklogSyncPassView = typeof syncPassSchema.Type
export type BacklogSyncItemView = typeof syncItemSchema.Type
export type BacklogSyncResultView = typeof syncResultSchema.Type
export type BacklogShippedView = typeof shippedOutputSchema.Type
export type BacklogShippedSummaryView = typeof shippedSummarySchema.Type
export type BacklogPeerStatusView = typeof peerStatusSchema.Type

export type BacklogSummaryInput = typeof summarySchema.Encoded
export type BacklogListInput = typeof listOutputSchema.Encoded
export type BacklogDetailInput = typeof detailSchema.Encoded

/**
 * Client boundary decode. The live DSH keeps its old Host until the user restarts, so a Host that predates item
 * attachments answers without them; decoding here fills the gap instead of letting a view dereference undefined.
 */
export class BacklogViews {
  static readonly summary = (value: BacklogSummaryInput): BacklogSummaryView => Schema.decodeUnknownSync(summarySchema)(value)

  static readonly list = (value: BacklogListInput): BacklogListView => Schema.decodeUnknownSync(listOutputSchema)(value)

  /**
   * Adds `hideAgentItems` only when a view hides them: the Host refuses unknown input keys, so a Host that predates the
   * filter keeps answering a view that shows everything.
   */
  static readonly hidingAgentItems = <Input extends object>(input: Input, hidden: boolean): Input | (Input & { readonly hideAgentItems: true }) =>
    hidden ? { ...input, hideAgentItems: true } : input

  /** The projects input for a view: no input at all unless it hides agent items, so a Host that predates the filter answers. */
  static readonly projectsInput = (hidden: boolean): { readonly hideAgentItems: true } | undefined => (hidden ? { hideAgentItems: true } : undefined)

  static readonly shipped = (value: typeof shippedOutputSchema.Encoded): BacklogShippedView => Schema.decodeUnknownSync(shippedOutputSchema)(value)

  static readonly detail = (value: BacklogDetailInput): BacklogDetailView => Schema.decodeUnknownSync(detailSchema)(value)

  static readonly detailResult = (result: BacklogDetailResult): BacklogDetailResult =>
    result.ok ? { ok: true, value: BacklogViews.detail(result.value) } : result
}
