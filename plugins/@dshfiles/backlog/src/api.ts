import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { BacklogItems } from './item.js'

const idSchema = z.number().int().positive()
const freshnessSchema = z.enum(BacklogItems.freshnessStates)
const fileInputSchema = BacklogItems.attachmentSchema.omit({ createdAt: true }).extend({ data: z.string().min(1).max(24_000_000) })
const fileOutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({ dataUrl: z.string().min(1), path: z.string().min(1).optional() }).strict() }).strict(),
  z.object({ ok: z.literal(false), reason: z.literal('not-found') }).strict(),
])
const speechStatusSchema = z
  .object({
    available: z.boolean(),
    ready: z.boolean(),
    provider: z.string().nullable(),
    language: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .strict()
const jevSetupStatusSchema = z.object({ needsSetup: z.boolean() }).strict()
const transcriptionSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string() }).strict(),
  z.object({ ok: z.literal(false), reason: z.string().max(500) }).strict(),
])

const summarySchema = z
  .object({
    id: idSchema,
    title: z.string(),
    kind: BacklogItems.kindSchema,
    status: BacklogItems.statusSchema,
    project: z.string().nullable(),
    tags: z.array(z.string()),
    links: z.array(BacklogItems.linkSchema),
    attachments: z.array(BacklogItems.attachmentSchema).default([]),
    actors: BacklogItems.itemSchema.shape.actors,
    pinned: z.boolean(),
    freshness: freshnessSchema,
    createdAt: z.number(),
    lastActivityAt: z.number(),
    preview: z.string(),
    proposal: BacklogItems.proposalSchema.nullable(),
    attention: BacklogItems.attentionSchema,
    acknowledgedAt: z.number().nullable(),
    snoozedUntil: z.number().nullable(),
    activity: z
      .object({
        count: z.number().int().nonnegative(),
        agents: z.number().int().nonnegative(),
        comments: z.number().int().nonnegative(),
        last: z.object({ at: z.number(), actor: z.string(), kind: z.string(), detail: z.string() }).strict().nullable(),
      })
      .strict(),
    match: z
      .object({ fields: z.array(z.enum(['id', 'title', 'tag', 'body', 'comment', 'link', 'project', 'capture'])), snippet: z.string().nullable() })
      .strict()
      .nullable(),
  })
  .strict()

const detailSchema = z
  .object({
    item: BacklogItems.itemSchema.extend({ freshness: freshnessSchema }),
    backlinks: z.array(summarySchema),
  })
  .strict()

const detailResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: detailSchema }).strict(),
  z.object({ ok: z.literal(false), reason: z.literal('not-found') }).strict(),
])

const detailManySchema = z
  .object({
    items: z.array(detailSchema),
    missing: z.array(idSchema),
  })
  .strict()

const listInputSchema = z
  .object({
    query: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Words that must all match (title, tags, body, comments, original capture, project, links; "quoted phrases" stay whole), plus optional operators: kind:bug status:doing is:blocked #tag project:name by:agent has:thread|revision|url updated:<7d updated:>30d. Results rank by relevance and say which fields matched.',
      ),
    statuses: z.array(BacklogItems.statusSchema).optional(),
    kinds: z.array(BacklogItems.kindSchema).optional(),
    project: z.string().max(BacklogItems.maxTargetChars).nullable().optional().describe('Absolute project path; null lists items outside any project.'),
    projects: z
      .array(z.string().max(BacklogItems.maxTargetChars).nullable())
      .optional()
      .describe('Several absolute project paths; null includes items outside any project, and an empty array applies no project filter.'),
    tag: z.string().max(60).optional(),
    actor: BacklogItems.actorIdSchema.optional().describe('`user`, `system` or `agent:<sessionId>`.'),
    freshness: z
      .enum(['active', 'all', ...BacklogItems.freshnessStates])
      .optional()
      .describe('`active` (default) hides dormant and archived items, like the feed; `all` includes them.'),
    inbox: z.boolean().optional().describe('Only open items that want the user: attention set, or a triage suggestion waiting; closed items are excluded.'),
    limit: z.number().int().positive().max(2_000).optional(),
  })
  .strict()

const listOutputSchema = z.object({ revision: z.number(), total: z.number().int().nonnegative(), items: z.array(summarySchema) }).strict()

const backfillOutputSchema = z
  .object({
    configured: z.boolean(),
    reason: z.string().max(500).nullable(),
    considered: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    proposed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  })
  .strict()

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
      input: z.void(),
      output: z.number(),
      description: 'A number that changes whenever any item changes; the panel polls it instead of the lists. Not an agent tool.',
    }),
    projects: method({
      input: z.void(),
      output: z.array(
        z
          .object({
            project: z.string().nullable(),
            counts: z.object({ inbox: z.number(), todo: z.number(), doing: z.number(), done: z.number(), dropped: z.number() }).strict(),
            needsYou: z.number().int().nonnegative(),
            actors: z.array(z.string()),
            lastActivityAt: z.number(),
          })
          .strict(),
      ),
      description: 'Every project items were captured in, with status counts over all items, how many need the user, and who worked on them. Read-only.',
      tool: { name: 'backlog_projects', readOnly: true },
    }),
    get: method({
      input: z.object({ id: idSchema }).strict(),
      output: detailResultSchema,
      description:
        'One backlog item `b:<id>` with its body, links, event history and the items that link to it. Read-only. Use `backlog_get_many` for several at once.',
      tool: { name: 'backlog_get', readOnly: true },
    }),
    getMany: method({
      input: z
        .object({
          ids: z.array(idSchema).min(1).max(50).describe('Item ids (`b:<id>` numbers). Duplicates are read once; unknown ids are reported, not failed.'),
        })
        .strict(),
      output: detailManySchema,
      description:
        'Several backlog items in one call, each with its body, links, event history and backlinks, in the order asked; ids that do not exist come back in `missing`. Read-only. Prefer it over repeated `backlog_get` calls.',
      tool: { name: 'backlog_get_many', readOnly: true },
    }),
    referencing: method({
      input: BacklogItems.linkSchema,
      output: z.array(summarySchema),
      description: 'Backlog items that link to a target: a thread (session id), a jj revision, a branch, a workspace, a URL or another item. Read-only.',
      tool: { name: 'backlog_referencing', readOnly: true },
    }),
    capture: method({
      input: z
        .object({
          text: z
            .string()
            .min(1)
            .max(BacklogItems.maxBodyChars)
            .describe(
              'Free text. First line is the title; a `bug:`/`idea:`/`note:`/`question:`/`task:` prefix sets the kind; `#tags`, `b:<id>`, `jj:<rev>`, `branch:<name>`, session ids and URLs become links.',
            ),
          project: z
            .string()
            .max(BacklogItems.maxTargetChars)
            .nullable()
            .optional()
            .describe("Absolute project path; an agent's working directory by default."),
          status: BacklogItems.statusSchema.optional().describe('Defaults to `inbox`.'),
          kind: BacklogItems.kindSchema.optional().describe('Overrides the kind the text prefix would derive.'),
          files: z
            .array(fileInputSchema)
            .max(BacklogItems.maxAttachments)
            .optional()
            .describe('Files to keep with the item: base64 `data` without a data-URL prefix, with kind, name, media type and byte size.'),
        })
        .strict(),
      output: detailSchema,
      description: `Add one item to the backlog; the calling thread is linked to it. ${writeNote}`,
      tool: { name: 'backlog_capture', readOnly: false },
    }),
    attachFile: method({
      input: z.object({ id: idSchema, file: fileInputSchema }).strict(),
      output: detailResultSchema,
      description: `Keep one image or file with an existing backlog item. ${writeNote}`,
      tool: { name: 'backlog_attach_file', readOnly: false },
    }),
    readFile: method({
      input: z
        .object({
          id: idSchema,
          attachmentId: z.string().min(1).max(64),
          save: z
            .boolean()
            .optional()
            .describe('Also write the bytes to a temporary file and return its absolute path, for an image or file reader that needs a path.'),
        })
        .strict(),
      output: fileOutputSchema,
      description: 'Read one image or file kept with a backlog item as a data URL, optionally also written to a temporary file. Read-only.',
      tool: { name: 'backlog_read_file', readOnly: true },
    }),
    removeFile: method({
      input: z.object({ id: idSchema, attachmentId: z.string().min(1).max(64) }).strict(),
      output: detailResultSchema,
      description: `Remove one image or file from a backlog item. ${writeNote}`,
      tool: { name: 'backlog_remove_file', readOnly: false },
    }),
    delete: method({
      input: z
        .object({ id: idSchema, confirm: z.literal(true).describe('Explicit opt-in acknowledging this permanently deletes the item and its attachments.') })
        .strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true) }).strict(),
        z.object({ ok: z.literal(false), reason: z.literal('not-found') }).strict(),
      ]),
      description:
        'Permanently delete a backlog item and its attachments. This cannot be undone; use it only when the user explicitly asked for deletion and pass confirm: true. Use it when the user asked, never to rewrite items unrelated to the task.',
      tool: { name: 'backlog_delete', readOnly: false },
    }),
    speechStatus: method({
      input: z.void(),
      output: speechStatusSchema,
      description: 'Whether the Host voice-input bundle can transcribe right now, with the selected provider and language. Not an agent tool.',
    }),
    jevSetupStatus: method({
      input: z.void(),
      output: jevSetupStatusSchema,
      description:
        'Whether enabled Backlog Jev lacks a resolvable key, returning setup state only and never any credential. Presentation-only status for the inline setup offer.',
    }),
    transcribeSpeech: method({
      input: z.object({ audioBase64: z.string().min(1).max(24_000_000) }).strict(),
      output: transcriptionSchema,
      description: 'Transcribe one browser microphone recording through the Host voice-input bundle. Not an agent tool.',
    }),
    update: method({
      input: z
        .object({
          id: idSchema,
          title: z.string().max(BacklogItems.maxTitleChars).optional(),
          body: z.string().max(BacklogItems.maxBodyChars).optional(),
          kind: BacklogItems.kindSchema.optional(),
          status: BacklogItems.statusSchema.optional().describe('Move the item; `dropped` closes it without doing it. Nothing is ever deleted.'),
          project: z.string().max(BacklogItems.maxTargetChars).nullable().optional(),
          tags: z.array(z.string().max(60)).max(20).optional(),
          pinned: z.boolean().optional(),
          attention: BacklogItems.attentionSchema
            .optional()
            .describe(
              '`needs-input` asks the user for a decision, `blocked` and `waiting` flag stalled work; `none` clears it. Pair it with a comment saying what is needed.',
            ),
          snoozedUntil: z.number().int().nonnegative().nullable().optional().describe('Hide the item until this epoch-ms time; null wakes it.'),
        })
        .strict(),
      output: detailResultSchema,
      description: `Edit or move one backlog item, or ask the user for input with \`attention\`. ${writeNote}`,
      tool: { name: 'backlog_update', readOnly: false },
    }),
    link: method({
      input: z.object({ id: idSchema, link: BacklogItems.linkSchema, remove: z.boolean().optional() }).strict(),
      output: detailResultSchema,
      description: `Link a backlog item to a thread, jj revision, branch, workspace, URL or another item (\`remove: true\` unlinks). ${writeNote}`,
      tool: { name: 'backlog_link', readOnly: false },
    }),
    startThread: method({
      input: z
        .object({
          ids: z.array(idSchema).min(1).max(20).describe('The items the thread works on; every one of them is linked and named in the opening message.'),
          workspaceId: z.string().min(1).max(200).optional().describe('Registered project to cut the thread its own jj workspace from. Exclusive with `cwd`.'),
          cwd: z
            .string()
            .min(1)
            .max(BacklogItems.maxTargetChars)
            .optional()
            .describe('Bare folder to run the thread in when it is not a registered project. Exclusive with `workspaceId`.'),
          agent: z.string().min(1).max(80).optional().describe('Agent handle (no `@`) whose preset, model route and instructions start the thread.'),
          provider: z.string().min(1).max(120).optional().describe('Account route for the thread when no agent is named.'),
          model: z.string().min(1).max(200).optional().describe('Model on that provider when no agent is named.'),
          reasoningEffort: z.string().min(1).max(60).optional().describe('Effort for that model, when its adapter advertises one.'),
          message: z
            .string()
            .max(4_000)
            .optional()
            .describe(
              "The thread's first message; the items' own headings by default. An agent's identity and instructions are prepended when `agent` is named.",
            ),
        })
        .strict(),
      output: z.object({ sessionId: z.string().min(1), linked: z.array(idSchema), missing: z.array(idSchema) }).strict(),
      description: `Start one thread for these items: it runs in its own jj workspace of their project, is named after the first item, told what to work on and linked to every item. ${writeNote}`,
      tool: { name: 'backlog_start_thread', readOnly: false },
    }),
    acknowledge: method({
      input: z.object({ ids: z.array(idSchema).max(500) }).strict(),
      output: z.void(),
      description: 'Mark Inbox items as seen by the user. Presentation state for the panel; not an agent tool.',
    }),
    triage: method({
      input: z.object({ id: idSchema }).strict(),
      output: detailResultSchema,
      description:
        'Run automatic triage on one item now (Jev and the configured cheap model). A confident answer applies, skipping fields the user set by hand; otherwise it is left as a proposal on the item.',
      tool: { name: 'backlog_triage', readOnly: false },
    }),
    backfillTriage: method({
      input: z
        .object({
          limit: z.number().int().min(1).max(100).optional().describe('How many items one run may triage, oldest first; defaults to 25.'),
          includeClosed: z.boolean().optional().describe('Also triage done and dropped items; the default covers open ones only.'),
          retriage: z.boolean().optional().describe('Also triage items triage already looked at, e.g. after changing the prompt or model.'),
        })
        .strict(),
      output: backfillOutputSchema,
      description: `Triage the backlog items that were captured before triage was set up, oldest first (Jev and the configured cheap model). A confident answer applies; a hesitant one waits on the item as a suggestion. Reports what it did and how many items it leaves for a later run. ${writeNote}`,
      tool: { name: 'backlog_triage_backfill', readOnly: false },
    }),
    applyProposal: method({
      input: z.object({ id: idSchema }).strict(),
      output: detailResultSchema,
      description: `Accept the triage proposal on an item: its kind, status, title and tags apply, and a suspected duplicate is linked. ${writeNote}`,
      tool: { name: 'backlog_accept_proposal', readOnly: false },
    }),
    dismissProposal: method({
      input: z.object({ id: idSchema }).strict(),
      output: detailResultSchema,
      description: `Dismiss the triage proposal on an item without changing it. ${writeNote}`,
      tool: { name: 'backlog_dismiss_proposal', readOnly: false },
    }),
    comment: method({
      input: z
        .object({
          id: idSchema,
          text: z.string().min(1).max(BacklogItems.maxBodyChars),
          files: z
            .array(fileInputSchema)
            .max(BacklogItems.maxAttachments)
            .optional()
            .describe('Images or files the comment carries: base64 `data` without a data-URL prefix, with kind, name, media type and byte size.'),
        })
        .strict(),
      output: detailResultSchema,
      description: `Add a progress comment to a backlog item, optionally with images or files; references in it become links. ${writeNote}`,
      tool: { name: 'backlog_comment', readOnly: false },
    }),
  },
})

export type BacklogSummaryView = z.infer<typeof summarySchema>
export type BacklogDetailView = z.infer<typeof detailSchema>
export type BacklogListView = z.infer<typeof listOutputSchema>
export type BacklogDetailResult = z.infer<typeof detailResultSchema>
export type BacklogBackfillResult = z.infer<typeof backfillOutputSchema>

export type BacklogSummaryInput = z.input<typeof summarySchema>
export type BacklogListInput = z.input<typeof listOutputSchema>
export type BacklogDetailInput = z.input<typeof detailSchema>

/**
 * Client boundary decode. The live DSH keeps its old Host until the user restarts, so a Host that predates item
 * attachments answers without them; decoding here fills the gap instead of letting a view dereference undefined.
 */
export class BacklogViews {
  static readonly summary = (value: BacklogSummaryInput): BacklogSummaryView => summarySchema.parse(value)

  static readonly list = (value: BacklogListInput): BacklogListView => listOutputSchema.parse(value)

  static readonly detail = (value: BacklogDetailInput): BacklogDetailView => detailSchema.parse(value)

  static readonly detailResult = (result: BacklogDetailResult): BacklogDetailResult =>
    result.ok ? { ok: true, value: BacklogViews.detail(result.value) } : result
}
