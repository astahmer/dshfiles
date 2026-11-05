import { defineApi, method } from '@dshfiles/dshx/api'
import { Effect, Schema, SchemaGetter } from 'effect'
import { AgentConfirmation } from './agent-confirmation.js'
import { BacklogBackfill } from './backfill.js'
import { BacklogReference } from './backlog-reference.js'
import { BacklogItems } from './item.js'
import { BacklogShipped } from './shipped.js'
import { BacklogSyncModel } from './sync-model.js'

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
})

const detailSchema = Schema.Struct({
  item: Schema.Struct({ ...BacklogItems.itemSchema.fields, freshness: freshnessSchema }),
  backlinks: Schema.Array(summarySchema),
  children: Schema.Array(summarySchema).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  blockedBy: Schema.Array(summarySchema).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  lease: nullDefault(leaseSchema),
})

const detailResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: detailSchema }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('not-found') }),
])

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
      'Words that must all match (title, tags, body, comments, original capture, project, links; "quoted phrases" stay whole), plus optional operators: kind:bug status:doing is:blocked #tag project:name by:agent (touched by) created:me|agent|system (captured by) has:thread|revision|url|children|parent updated:<7d updated:>30d priority:urgent|high|medium|low|none parent:b:k3f9 is:ready is:blocked-by-deps is:delegated is:claimed delegate:agent. A leading - negates any operator or word (-created:agent, -kind:note, -#tag, -priority:none). Results rank by relevance and say which fields matched.',
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
})

const previewText = (text: string): string => text.trim().replace(/\s+/g, ' ').slice(0, 240)

const renderItemPreview = (item: (typeof detailSchema.Type)['item']): string => {
  const body = previewText(item.body)
  const status = `${item.kind} · ${item.status}${(item.priority ?? 'none') === 'none' ? '' : ` · ${item.priority ?? ''}`}${item.parent === undefined ? '' : ` · under b:${item.parent}`}`
  const project = item.project === null ? '' : ` · ${item.project}`
  return [`${BacklogReference.labelOf(item)} — ${item.title}`, `${status}${project}`, ...(body === '' ? [] : [body])].join('\n')
}

const renderDetailPreview = (result: typeof detailResultSchema.Type): string => (result.ok ? renderItemPreview(result.value.item) : 'No backlog item found.')

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
const syncItemSchema = Schema.Struct({
  itemId: idSchema,
  ref: refOutputSchema,
  backend: BacklogSyncModel.backendSchema,
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
  remoteKey: Schema.NullOr(Schema.String),
  state: syncStateSchema,
  pulled: Schema.Array(Schema.Literals(BacklogSyncModel.syncedFields)),
  pushed: Schema.Array(Schema.Literals(BacklogSyncModel.syncedFields)),
  conflicts: Schema.Array(BacklogSyncModel.conflictSchema),
  commentsPulled: nonNegativeCountSchema,
  commentsPushed: nonNegativeCountSchema,
  error: Schema.NullOr(syncErrorViewSchema),
})
const syncStatusSchema = Schema.Struct({
  backends: Schema.Array(
    Schema.Struct({
      project: Schema.NullOr(Schema.String),
      backend: BacklogSyncModel.backendSchema,
      target: Schema.String,
      enabled: Schema.Boolean,
      autoSyncMinutes: nonNegativeCountSchema,
      credential: Schema.Literals(['reference', 'environment', 'github-cli', 'missing']),
    }),
  ),
  items: Schema.Array(syncItemSchema),
})
const syncTargetSchema = Schema.Struct({ key: Schema.String, name: Schema.String })
const syncConnectionSchema = Schema.Struct({
  ok: Schema.Boolean,
  credential: Schema.Literals(['reference', 'environment', 'github-cli', 'missing']),
  account: Schema.NullOr(Schema.String),
  target: Schema.NullOr(syncTargetSchema),
  targetSource: Schema.NullOr(Schema.Literals(['setting', 'git-remote', 'only-team', 'per-project'])),
  teams: Schema.Array(syncTargetSchema),
  error: Schema.NullOr(syncErrorViewSchema),
})

const renderSyncConnection = (output: typeof syncConnectionSchema.Type): string => {
  if (output.error !== null) return output.error.message
  const target = output.target === null ? (output.targetSource === 'per-project' ? "each project's git remote" : 'no target') : output.target.key
  return `Connected as ${output.account ?? '?'} → ${target} (key: ${output.credential}).`
}
const savedSyncConnectionSchema = Schema.Struct({
  backend: BacklogSyncModel.backendSchema,
  project: Schema.String,
  target: Schema.String,
  enabled: Schema.Boolean,
  report: syncConnectionSchema,
})
const renderSavedSyncConnections = (output: { readonly results: readonly (typeof savedSyncConnectionSchema.Type)[] }): string =>
  output.results.length === 0
    ? 'No sync backends are saved. Add one under Backlog settings › Remote sync.'
    : output.results
        .map(
          result =>
            `${result.backend} · ${result.project === '' ? 'all other projects' : result.project}${result.enabled ? '' : ' (disabled)'}: ${renderSyncConnection(result.report)}`,
        )
        .join('\n')
const remoteReferenceSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars)).annotate({
  description: 'The issue: a URL, a Linear identifier such as ENG-12, or a GitHub issue number such as 42.',
})

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
  byAgent: Schema.Boolean,
  revisions: Schema.Array(Schema.String),
  pullRequests: Schema.Array(Schema.String),
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

const renderReady = (output: typeof listOutputSchema.Type): string =>
  output.items.length === 0
    ? 'Nothing is ready: every open item is blocked, has open sub-issues, is claimed or snoozed.'
    : output.items
        .map(
          item =>
            `${BacklogReference.labelOf(item)} ${item.priority === 'none' ? '' : `[${item.priority}] `}${item.title}${item.project === null ? '' : ` · ${item.project}`}`,
        )
        .join('\n')

const renderClaim = (result: typeof detailResultSchema.Type): string =>
  result.ok
    ? `${renderItemPreview(result.value.item)}\n${result.value.lease === null ? 'No claim held.' : `Claimed by ${result.value.lease.holder} until ${new Date(result.value.lease.expiresAt).toISOString()}; any write by it renews the claim.`}`
    : 'No backlog item found.'

const writeNote = 'Use it when the user asked, or to record and progress work this thread is doing; never to rewrite items unrelated to the task.'

/** No default: a bare agent request cannot run a guarded write. */
const confirmSchema = Schema.Boolean.pipe(Schema.optional).annotate({ description: AgentConfirmation.confirmDescription })

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
      description: 'A number that changes whenever any item changes; the panel polls it instead of the lists. Not an agent tool.',
    }),
    aiActivity: method({
      input: Schema.Void,
      output: Schema.Struct({ active: Schema.Boolean }),
      description: 'Whether Host-scheduled backlog AI work is currently running. Presentation-only status; not an agent tool.',
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
      tool: { name: 'backlog_get', readOnly: true, render: renderDetailPreview },
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
      }),
      output: detailResultSchema,
      description: `Edit or move one backlog item, or ask the user for input with \`attention\`. ${writeNote}`,
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
        'Remote sync of backlog items: the configured backends (Linear teams, GitHub repositories) with whether a key is bound, and each linked item with its issue, sync state (synced, pending, conflict, error), last sync time, last error and recent conflicts. Read-only.',
      tool: { name: 'backlog_sync_status', readOnly: true },
    }),
    syncNow: method({
      input: Schema.Struct({
        id: itemKeySchema.pipe(Schema.optional).annotate({ description: 'One linked item; omit to sync every linked item (of `project`, when given).' }),
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'Only linked items of this project; null selects items without a project.' }),
        confirm: confirmSchema,
      }),
      output: Schema.Struct({ results: Schema.Array(syncResultSchema) }),
      description: `Sync linked backlog items with their Linear or GitHub issues now: title, description, status and tags flow both ways (a field both sides changed goes to the side that changed last, with a conflict note on the item), and new comments are carried over once. Run only when the user asked. Without \`id\` it syncs every linked item, which an agent may run only with \`confirm: true\`. ${writeNote}`,
      tool: { name: 'backlog_sync_now', readOnly: false, render: renderSyncResults },
    }),
    linkRemote: method({
      input: Schema.Struct({
        id: itemKeySchema,
        backend: BacklogSyncModel.backendSchema,
        reference: remoteReferenceSchema.pipe(Schema.optional),
        create: Schema.Boolean.pipe(Schema.optional).annotate({
          description: 'Create a new issue from the item in the configured team or repository instead of linking `reference`.',
        }),
        remove: Schema.Boolean.pipe(Schema.optional).annotate({
          description: 'Unlink the item from its issue and stop syncing it; neither side is deleted. Link it again to resume.',
        }),
      }).check(
        Schema.makeFilter(input =>
          input.remove === true || input.create === true || (input.reference ?? '') !== '' ? undefined : 'Pass `reference`, `create: true` or `remove: true`.',
        ),
      ),
      output: Schema.Struct({ item: Schema.NullOr(syncItemSchema), result: Schema.NullOr(syncResultSchema) }),
      description: `Link one backlog item to a Linear or GitHub issue (adopting the issue's fields on the first sync, tags merged), create a new issue from it, or unlink it with \`remove: true\`. The issue URL is added to the item's links. Run only when the user asked; it writes to the remote tracker. ${writeNote}`,
      tool: { name: 'backlog_link_remote', readOnly: false },
    }),
    testSyncBackend: method({
      input: Schema.Struct({
        backend: BacklogSyncModel.backendSchema,
        project: Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars))
          .pipe(Schema.optional)
          .annotate({ description: 'Absolute project path the row serves; empty or omitted serves every other project.' }),
        target: Schema.String.check(Schema.isMaxLength(200)).pipe(Schema.optional).annotate({
          description: "Linear team key or GitHub owner/repo. Empty: Linear uses the key's only team; GitHub reads the project's github.com git remote.",
        }),
        secret: Schema.String.check(Schema.isMaxLength(400)).pipe(Schema.optional).annotate({
          description: 'secret:ALIAS reference to the key. Empty: LINEAR_API_KEY, or GITHUB_TOKEN / GH_TOKEN / a signed-in gh CLI on the Host.',
        }),
      }),
      output: syncConnectionSchema,
      description:
        'Test a Linear or GitHub sync backend (saved or not) on the Host: where its key comes from, the account it signs in as, the team or repository it reaches and, for Linear, every team the key can see. The key never leaves the Host. Read-only.',
      tool: { name: 'backlog_sync_test_connection', readOnly: true, render: renderSyncConnection },
    }),
    testSyncBackends: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ results: Schema.Array(savedSyncConnectionSchema) }),
      description:
        'Test every saved Linear and GitHub sync backend row on the Host (the Test all button): each row with its tracker, project, target and enabled state, and the same report as backlog_sync_test_connection. The keys never leave the Host. Read-only.',
      tool: { name: 'backlog_sync_test_all', readOnly: true, render: renderSavedSyncConnections },
    }),
    importRemote: method({
      input: Schema.Struct({
        backend: BacklogSyncModel.backendSchema.pipe(Schema.optional).annotate({
          description: 'Tracker of the issue; omit to read it from the reference (ENG-12 or linear.app is Linear; #42, owner/repo#42 or github.com is GitHub).',
        }),
        reference: remoteReferenceSchema,
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'Project the new item belongs to; defaults to the project of the first enabled row for that backend.' }),
      }),
      output: Schema.Struct({ detail: detailSchema, created: Schema.Boolean }),
      description: `Import an existing Linear or GitHub issue as a new backlog item linked to it, with its title, description, status, labels and comments; an issue already linked returns its item. Run only when the user asked. ${writeNote}`,
      tool: { name: 'backlog_import_remote', readOnly: false, render: output => renderItemPreview(output.detail.item) },
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
          description: 'The changed field to put back: title, body, kind, status, project, tags, pinned or attention.',
        }),
        confirm: confirmSchema,
      }),
      output: revertResultSchema,
      description:
        'Revert one recorded field change of a backlog item: writes the typed value the field held before that change, read from the op log, as a new change. Refused with `stale` when the field changed again since. Run only when the user asked to revert that change, and pass `confirm: true`; an agent call without it is refused.',
      tool: { name: 'backlog_revert', readOnly: false, render: renderRevertPreview },
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
  },
})

export type BacklogSummaryView = typeof summarySchema.Type
export type BacklogDetailView = typeof detailSchema.Type
export type BacklogListView = typeof listOutputSchema.Type
export type BacklogDetailResult = typeof detailResultSchema.Type
export type BacklogRevertResult = typeof revertResultSchema.Type
export type BacklogBackfillResult = typeof backfillOutputSchema.Type
export type BacklogSyncStatusView = typeof syncStatusSchema.Type
export type BacklogSyncItemView = typeof syncItemSchema.Type
export type BacklogSyncResultView = typeof syncResultSchema.Type
export type BacklogShippedView = typeof shippedOutputSchema.Type
export type BacklogShippedSummaryView = typeof shippedSummarySchema.Type

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
