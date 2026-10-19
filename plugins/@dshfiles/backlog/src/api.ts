import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { BacklogItems } from './item.js'

const idSchema = z.number().int().positive()
const freshnessSchema = z.enum(BacklogItems.freshnessStates)

const summarySchema = z
  .object({
    id: idSchema,
    title: z.string(),
    kind: BacklogItems.kindSchema,
    status: BacklogItems.statusSchema,
    project: z.string().nullable(),
    tags: z.array(z.string()),
    links: z.array(BacklogItems.linkSchema),
    actors: BacklogItems.itemSchema.shape.actors,
    pinned: z.boolean(),
    freshness: freshnessSchema,
    createdAt: z.number(),
    lastActivityAt: z.number(),
    preview: z.string(),
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

const listInputSchema = z
  .object({
    query: z.string().max(500).optional().describe('Space-separated words that must all appear in the title, body, tags, project or link targets.'),
    statuses: z.array(BacklogItems.statusSchema).optional(),
    kinds: z.array(BacklogItems.kindSchema).optional(),
    project: z.string().max(BacklogItems.maxTargetChars).optional().describe('Absolute project path.'),
    tag: z.string().max(60).optional(),
    actor: BacklogItems.actorIdSchema.optional().describe('`user`, `system` or `agent:<sessionId>`.'),
    freshness: z
      .enum(['active', 'all', ...BacklogItems.freshnessStates])
      .optional()
      .describe('`active` (default) hides dormant and archived items, like the feed; `all` includes them.'),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict()

const listOutputSchema = z.object({ revision: z.number(), total: z.number().int().nonnegative(), items: z.array(summarySchema) }).strict()

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
        'List or search backlog items (tasks, bugs, ideas, notes, questions), newest activity first. Dormant and archived items are hidden unless `freshness` asks for them. Read-only.',
      tool: { name: 'backlog_list', readOnly: true },
    }),
    get: method({
      input: z.object({ id: idSchema }).strict(),
      output: detailResultSchema,
      description: 'One backlog item `b:<id>` with its body, links, event history and the items that link to it. Read-only.',
      tool: { name: 'backlog_get', readOnly: true },
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
        })
        .strict(),
      output: detailSchema,
      description: `Add one item to the backlog; the calling thread is linked to it. ${writeNote}`,
      tool: { name: 'backlog_capture', readOnly: false },
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
        })
        .strict(),
      output: detailResultSchema,
      description: `Edit or move one backlog item. ${writeNote}`,
      tool: { name: 'backlog_update', readOnly: false },
    }),
    link: method({
      input: z.object({ id: idSchema, link: BacklogItems.linkSchema, remove: z.boolean().optional() }).strict(),
      output: detailResultSchema,
      description: `Link a backlog item to a thread, jj revision, branch, workspace, URL or another item (\`remove: true\` unlinks). ${writeNote}`,
      tool: { name: 'backlog_link', readOnly: false },
    }),
    comment: method({
      input: z.object({ id: idSchema, text: z.string().min(1).max(BacklogItems.maxBodyChars) }).strict(),
      output: detailResultSchema,
      description: `Add a progress comment to a backlog item; references in it become links. ${writeNote}`,
      tool: { name: 'backlog_comment', readOnly: false },
    }),
  },
})

export type BacklogSummaryView = z.infer<typeof summarySchema>
export type BacklogDetailView = z.infer<typeof detailSchema>
