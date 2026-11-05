import { defineApi, method } from '@dshfiles/dshx/api'
import { Effect, Schema, SchemaGetter } from 'effect'
import { BacklogItems } from './item.js'
import { BacklogSyncModel } from './sync-model.js'

const idSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
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
  id: idSchema,
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

const summarySchema = Schema.Struct({
  id: idSchema,
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
})

const detailSchema = Schema.Struct({
  item: Schema.Struct({ ...BacklogItems.itemSchema.fields, freshness: freshnessSchema }),
  backlinks: Schema.Array(summarySchema),
})

const detailResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: detailSchema }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literal('not-found') }),
])

const detailManySchema = Schema.Struct({
  items: Schema.Array(detailSchema),
  missing: Schema.Array(idSchema),
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
      'Words that must all match (title, tags, body, comments, original capture, project, links; "quoted phrases" stay whole), plus optional operators: kind:bug status:doing is:blocked #tag project:name by:agent (touched by) created:me|agent|system (captured by) has:thread|revision|url updated:<7d updated:>30d. A leading - negates any operator or word (-created:agent, -kind:note, -#tag). Results rank by relevance and say which fields matched.',
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
  const status = `${item.kind} · ${item.status}`
  const project = item.project === null ? '' : ` · ${item.project}`
  return [`b:${String(item.id)} — ${item.title}`, `${status}${project}`, ...(body === '' ? [] : [body])].join('\n')
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
            ? `b:${String(result.itemId)} ↔ ${result.remoteKey ?? '?'}: ${result.state}${result.pulled.length > 0 ? ` · pulled ${result.pulled.join(', ')}` : ''}${result.pushed.length > 0 ? ` · pushed ${result.pushed.join(', ')}` : ''}`
            : `b:${String(result.itemId)}: ${result.error.message}`,
        )
        .join('\n')

const writeNote = 'Use it when the user asked, or to record and progress work this thread is doing; never to rewrite items unrelated to the task.'

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
      input: Schema.Void,
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
      input: Schema.Struct({ id: idSchema }),
      output: detailResultSchema,
      description:
        'One backlog item `b:<id>` with its body, links, event history and the items that link to it. Read-only. Use `backlog_get_many` for several at once.',
      tool: { name: 'backlog_get', readOnly: true, render: renderDetailPreview },
    }),
    getMany: method({
      input: Schema.Struct({
        ids: Schema.Array(idSchema)
          .check(Schema.isMinLength(1), Schema.isMaxLength(50))
          .annotate({ description: 'Item ids (`b:<id>` numbers). Duplicates are read once; unknown ids are reported, not failed.' }),
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
            'Free text. First line is the title; a `bug:`/`idea:`/`note:`/`question:`/`task:` prefix sets the kind; `#tags`, `b:<id>`, `jj:<rev>`, `branch:<name>`, session ids and URLs become links.',
        }),
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: "Absolute project path; an agent's working directory by default." }),
        status: BacklogItems.statusSchema.pipe(Schema.optional).annotate({ description: 'Defaults to `inbox`.' }),
        kind: BacklogItems.kindSchema.pipe(Schema.optional).annotate({ description: 'Overrides the kind the text prefix would derive.' }),
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
      input: Schema.Struct({ id: idSchema, file: fileInputSchema }),
      output: detailResultSchema,
      description: `Keep one image or file with an existing backlog item. ${writeNote}`,
      tool: { name: 'backlog_attach_file', readOnly: false, render: renderDetailPreview },
    }),
    readFile: method({
      input: Schema.Struct({
        id: idSchema,
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
      input: Schema.Struct({ id: idSchema, attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)) }),
      output: detailResultSchema,
      description: `Remove one image or file from a backlog item. ${writeNote}`,
      tool: { name: 'backlog_remove_file', readOnly: false, render: renderDetailPreview },
    }),
    delete: method({
      input: Schema.Struct({
        id: idSchema,
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
        id: idSchema,
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
      input: Schema.Struct({ id: idSchema, url: BacklogItems.tweetContextUrlSchema }),
      output: detailResultSchema,
      description: `Retrieve public tweet text and media for a URL already in one backlog item. Use it when the user asked; this sends the post ID to FxEmbed and appends quoted, untrusted tweet text plus available images without replacing the existing description.`,
      tool: { name: 'backlog_enrich_tweet', readOnly: false, render: renderDetailPreview },
    }),
    update: method({
      input: Schema.Struct({
        id: idSchema,
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
      }),
      output: detailResultSchema,
      description: `Edit or move one backlog item, or ask the user for input with \`attention\`. ${writeNote}`,
      tool: { name: 'backlog_update', readOnly: false, render: renderDetailPreview },
    }),
    link: method({
      input: Schema.Struct({ id: idSchema, link: BacklogItems.linkSchema, remove: Schema.Boolean.pipe(Schema.optional) }),
      output: detailResultSchema,
      description: `Link a backlog item to a thread, jj revision, branch, workspace, URL or another item (\`remove: true\` unlinks). ${writeNote}`,
      tool: { name: 'backlog_link', readOnly: false, render: renderDetailPreview },
    }),
    agentContinuationCandidates: method({
      input: Schema.Struct({ id: idSchema, handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)) }),
      output: Schema.Array(agentContinuationCandidateSchema).check(Schema.isMaxLength(50)),
      description: 'List threads for an agent that are already linked to one backlog item, for an explicit continue-or-new choice.',
    }),
    continueAgentThread: method({
      input: Schema.Struct({
        id: idSchema,
        handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
        sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
        text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxBodyChars)),
      }),
      output: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)), queued: Schema.Literal(true) }),
      description: 'Validate one linked thread belongs to the mentioned agent and queue the task into it.',
    }),
    startThread: method({
      input: Schema.Struct({
        ids: Schema.Array(idSchema)
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
      output: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)), linked: Schema.Array(idSchema), missing: Schema.Array(idSchema) }),
      description: `Start one thread for these items: it runs in its own jj workspace of their project, is named after the first item, receives every selected item's full description, all current replies in order, and every item- and reply-level attachment, and links to every item. Missing or unreadable items/files and upload or prompt failures reject the start instead of silently omitting context. ${writeNote}`,
      tool: { name: 'backlog_start_thread', readOnly: false },
    }),
    syncStatus: method({
      input: Schema.Struct({
        ids: Schema.Array(idSchema)
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
        id: idSchema.pipe(Schema.optional).annotate({ description: 'One linked item; omit to sync every linked item (of `project`, when given).' }),
        project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)))
          .pipe(Schema.optional)
          .annotate({ description: 'Only linked items of this project; null selects items without a project.' }),
      }),
      output: Schema.Struct({ results: Schema.Array(syncResultSchema) }),
      description: `Sync linked backlog items with their Linear or GitHub issues now: title, description, status and tags flow both ways (a field both sides changed goes to the side that changed last, with a conflict note on the item), and new comments are carried over once. Run only when the user asked. ${writeNote}`,
      tool: { name: 'backlog_sync_now', readOnly: false, render: renderSyncResults },
    }),
    linkRemote: method({
      input: Schema.Struct({
        id: idSchema,
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
      input: Schema.Struct({ ids: Schema.Array(idSchema).check(Schema.isMaxLength(500)) }),
      output: Schema.Void,
      description: 'Mark Inbox items as seen by the user. Presentation state for the panel; not an agent tool.',
    }),
    triage: method({
      input: Schema.Struct({ id: idSchema }),
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
      }),
      output: backfillOutputSchema,
      description: `Start a background triage backfill for inbox/todo tasks only (Jev and the configured cheap model). Returns a job id immediately; check backlog_triage_backfill_status to follow progress. A confident answer applies; a hesitant one waits on the item as a suggestion. ${writeNote}`,
      tool: { name: 'backlog_triage_backfill', readOnly: false },
    }),
    backfillTriageStatus: method({
      input: Schema.Struct({ jobId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)) }),
      output: Schema.NullOr(backfillOutputSchema),
      description: 'Read progress for one backlog triage backfill job by its returned job id.',
      tool: { name: 'backlog_triage_backfill_status', readOnly: true },
    }),
    applyProposal: method({
      input: Schema.Struct({ id: idSchema }),
      output: detailResultSchema,
      description: `Accept the triage proposal on an item: its kind, status, title and tags apply, and a suspected duplicate is linked. ${writeNote}`,
      tool: { name: 'backlog_accept_proposal', readOnly: false, render: renderDetailPreview },
    }),
    dismissProposal: method({
      input: Schema.Struct({ id: idSchema }),
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
        id: idSchema,
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
    deleteComment: method({
      input: Schema.Struct({ id: idSchema, commentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)) }),
      output: detailResultSchema,
      description: 'Delete one of the current user’s previous replies in the backlog panel.',
    }),
  },
})

export type BacklogSummaryView = typeof summarySchema.Type
export type BacklogDetailView = typeof detailSchema.Type
export type BacklogListView = typeof listOutputSchema.Type
export type BacklogDetailResult = typeof detailResultSchema.Type
export type BacklogBackfillResult = typeof backfillOutputSchema.Type
export type BacklogSyncStatusView = typeof syncStatusSchema.Type
export type BacklogSyncItemView = typeof syncItemSchema.Type
export type BacklogSyncResultView = typeof syncResultSchema.Type

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

  static readonly detail = (value: BacklogDetailInput): BacklogDetailView => Schema.decodeUnknownSync(detailSchema)(value)

  static readonly detailResult = (result: BacklogDetailResult): BacklogDetailResult =>
    result.ok ? { ok: true, value: BacklogViews.detail(result.value) } : result
}
