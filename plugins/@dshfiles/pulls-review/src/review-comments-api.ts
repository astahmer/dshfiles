import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/** A comment thread lives at most this long; the oldest resolved thread goes first. */
export const MAX_COMMENT_THREADS = 2_000

const bodySchema = z.string().trim().min(1).max(8_000)

export const commentAuthorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('agent'), sessionId: z.string().min(1).max(128).optional() }).strict(),
])
export type CommentAuthor = z.infer<typeof commentAuthorSchema>

export const commentSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('turn'), sessionId: z.string().min(1).max(128), seq: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('workspace'), path: z.string().min(1).max(2048), base: z.string().min(1).max(256), head: z.string().min(1).max(256) }).strict(),
])
export type CommentSource = z.infer<typeof commentSourceSchema>

export const commentAnchorSchema = z.object({ side: z.enum(['old', 'new']), line: z.number().int().positive() }).strict()
export type CommentAnchor = z.infer<typeof commentAnchorSchema>

export const commentReplySchema = z
  .object({
    id: z.string().min(1).max(64),
    body: bodySchema,
    author: commentAuthorSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
export type CommentReply = z.infer<typeof commentReplySchema>

export const commentThreadSchema = z
  .object({
    id: z.string().min(1).max(64),
    source: commentSourceSchema,
    path: z.string().min(1).max(2048),
    anchor: commentAnchorSchema,
    body: bodySchema,
    author: commentAuthorSchema,
    createdAt: z.number().int().nonnegative(),
    resolvedAt: z.number().int().nonnegative().optional(),
    replies: z.array(commentReplySchema).max(200),
  })
  .strict()
export type CommentThread = z.infer<typeof commentThreadSchema>

const threadListSchema = z.object({ threads: z.array(commentThreadSchema) }).strict()

export const reviewCommentsApi = defineApi({
  id: 'changes-review-comments',
  version: 1,
  owner: '@dshfiles/pulls-review',
  methods: {
    list: method({
      input: z.object({ source: commentSourceSchema }).strict(),
      output: threadListSchema,
      description: 'Every comment thread on one review, in the order they were anchored.',
      tool: { name: 'review_comments', readOnly: true, render: output => `${output.threads.length} review comment threads` },
    }),
    create: method({
      input: z.object({ source: commentSourceSchema, path: z.string().min(1).max(2048), anchor: commentAnchorSchema, body: bodySchema }).strict(),
      output: commentThreadSchema,
      description: 'Anchor a new comment thread to one line of one reviewed file. Run only when the user asked for this comment.',
      tool: {
        name: 'review_comment_create',
        readOnly: false,
        render: thread => `comment on ${thread.path}:${String(thread.anchor.line)} (${thread.id})`,
      },
    }),
    reply: method({
      input: z.object({ id: z.string().min(1).max(64), body: bodySchema }).strict(),
      output: commentThreadSchema,
      description: 'Reply in an existing review comment thread. Run only when the user asked for this reply.',
      tool: { name: 'review_comment_reply', readOnly: false, render: thread => `${thread.replies.length} replies on ${thread.path}` },
    }),
    setResolved: method({
      input: z.object({ id: z.string().min(1).max(64), resolved: z.boolean() }).strict(),
      output: commentThreadSchema,
      description: 'Resolve or reopen a review comment thread. Run only when the user asked to resolve it.',
      tool: { name: 'review_comment_resolve', readOnly: false, render: thread => `${thread.id} ${thread.resolvedAt === undefined ? 'reopened' : 'resolved'}` },
    }),
    delete: method({
      input: z.object({ id: z.string().min(1).max(64), confirm: z.literal(true) }).strict(),
      output: z.object({ deleted: z.literal(true) }).strict(),
      description: 'Delete one review comment thread and its replies. Destructive: pass confirm: true, and only when the user asked for it.',
      tool: { name: 'review_comment_delete', readOnly: false, render: () => 'comment thread deleted' },
    }),
  },
})
