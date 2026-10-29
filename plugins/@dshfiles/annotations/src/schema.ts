import { z } from 'zod'

const MAX_NOTE_CHARS = 2000
export const MAX_TEXT_CHARS = 240
export const MAX_SELECTOR_CHARS = 600
export const MAX_ATTRIBUTES = 8
export const MAX_ATTRIBUTE_CHARS = 120
export const MAX_STYLES = 16
export const MAX_URL_CHARS = 400
export const MAX_DRAFT_ITEMS = 8
export const MAX_DRAFT_CHARS = 4000
const MAX_ITEMS_PER_CREATE = 8
export const MAX_THREAD_MESSAGES = 50
export const MAX_ANNOTATIONS_PER_SESSION = 2000
export const MAX_UNASSIGNED = 100

const annotationStatusSchema = z.enum(['pending', 'acknowledged', 'resolved', 'dismissed', 'stale'])
const annotationIntentSchema = z.enum(['fix', 'change', 'question', 'approve'])
const annotationSeveritySchema = z.enum(['blocking', 'important', 'suggestion'])
const annotationSurfaceSchema = z.enum(['dsh', 'preview', 'external'])
const annotationKindSchema = z.enum(['element', 'region', 'text'])
const annotationStaleReasonSchema = z.enum(['element-missing', 'text-changed', 'route-changed'])
const annotationOriginSchema = z.enum(['dsh', 'extension'])

const annotationRectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict()

const annotationSourceSchema = z
  .object({
    file: z.string().min(1).max(400),
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
    confidence: z.enum(['map', 'text', 'file']),
  })
  .strict()

export const annotationTargetSchema = z
  .object({
    surface: annotationSurfaceSchema,
    url: z.string().max(MAX_URL_CHARS),
    selector: z.string().min(1).max(MAX_SELECTOR_CHARS),
    tag: z.string().min(1).max(40),
    text: z.string().max(MAX_TEXT_CHARS).optional(),
    attributes: z.record(z.string().max(60), z.string().max(MAX_ATTRIBUTE_CHARS)).optional(),
    styles: z.record(z.string().max(40), z.string().max(120)).optional(),
    rect: annotationRectSchema,
    source: annotationSourceSchema.optional(),
    staleReason: annotationStaleReasonSchema.optional(),
  })
  .strict()

const annotationThreadMessageSchema = z
  .object({
    id: z.string().min(1).max(40),
    role: z.enum(['human', 'agent']),
    body: z.string().min(1).max(MAX_NOTE_CHARS),
    at: z.number().int().nonnegative(),
  })
  .strict()

export const annotationSchema = z
  .object({
    id: z.string().regex(/^ann_[1-9][0-9]*$/),
    sessionId: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    status: annotationStatusSchema,
    kind: annotationKindSchema,
    target: annotationTargetSchema,
    note: z.string().max(MAX_NOTE_CHARS),
    intent: annotationIntentSchema.optional(),
    severity: annotationSeveritySchema.optional(),
    thread: z.array(annotationThreadMessageSchema).max(MAX_THREAD_MESSAGES),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    resolvedAt: z.number().int().nonnegative().optional(),
    resolvedBy: z.enum(['human', 'agent']).optional(),
    resolution: z
      .object({ revision: z.number().int().positive(), summary: z.string().max(MAX_NOTE_CHARS).optional() })
      .strict()
      .optional(),
    origin: annotationOriginSchema,
  })
  .strict()

export const annotationDraftSchema = z
  .object({
    kind: annotationKindSchema,
    target: annotationTargetSchema,
    note: z.string().max(MAX_NOTE_CHARS),
    intent: annotationIntentSchema.optional(),
    severity: annotationSeveritySchema.optional(),
  })
  .strict()

const annotationCountsSchema = z
  .object({
    pending: z.number().int().nonnegative(),
    acknowledged: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
  })
  .strict()

export const createInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    items: z.array(annotationDraftSchema).min(1).max(MAX_ITEMS_PER_CREATE),
    origin: annotationOriginSchema.optional(),
  })
  .strict()

export const listInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    statuses: z.array(annotationStatusSchema).max(5).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict()

export const shownOutputSchema = z
  .object({
    annotations: z.array(annotationSchema).max(200),
    counts: annotationCountsSchema,
  })
  .strict()

export const ackInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    ids: z
      .array(z.string().regex(/^ann_[1-9][0-9]*$/))
      .min(1)
      .max(50),
  })
  .strict()

export const resolveInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    id: z.string().regex(/^ann_[1-9][0-9]*$/),
    revision: z.number().int().positive(),
    summary: z.string().max(MAX_NOTE_CHARS).optional(),
  })
  .strict()

export const dismissInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    id: z.string().regex(/^ann_[1-9][0-9]*$/),
    reason: z.string().min(1).max(MAX_NOTE_CHARS),
  })
  .strict()

export const staleInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    id: z.string().regex(/^ann_[1-9][0-9]*$/),
    reason: annotationStaleReasonSchema,
  })
  .strict()

export const replyInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    id: z.string().regex(/^ann_[1-9][0-9]*$/),
    body: z.string().min(1).max(MAX_NOTE_CHARS),
    role: z.enum(['human', 'agent']).optional(),
  })
  .strict()

export const previewInputSchema = z.object({ path: z.string().min(1).max(400) }).strict()

export const previewOutputSchema = z.union([
  z.object({ ok: z.literal(true), path: z.string(), html: z.string(), truncated: z.boolean() }).strict(),
  z.object({ ok: z.literal(false), error: z.enum(['outside-workspace', 'unsupported', 'missing', 'too-large']) }).strict(),
])

const chromePageSchema = z.object({ id: z.string().max(200), title: z.string().max(400), url: z.string().max(600) }).strict()

export const chromeStatusOutputSchema = z
  .object({
    running: z.boolean(),
    endpoint: z.string().max(200),
    executable: z.string().max(400),
    pages: z.array(chromePageSchema).max(50),
  })
  .strict()

export const chromePickInputSchema = z.object({ pageId: z.string().min(1).max(200).optional() }).strict()

export const chromePickOutputSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      target: annotationTargetSchema,
      point: z.object({ x: z.number(), y: z.number() }).strict(),
    })
    .strict(),
  z.object({ ok: z.literal(false), reason: z.enum(['cancelled', 'timeout', 'unavailable', 'no-page']) }).strict(),
])

export const pairInputSchema = z.object({ action: z.enum(['arm', 'status']) }).strict()

export const pairOutputSchema = z
  .object({
    armed: z.boolean(),
    expiresAt: z.number().int().nonnegative().optional(),
    pairedAt: z.number().int().nonnegative().optional(),
  })
  .strict()

export const setupOutputSchema = z
  .object({
    extensionPath: z.string().max(400),
    extensionId: z.string().max(64),
    chromePath: z.string().max(400),
    pickActiveTab: z.boolean(),
    startUrl: z.string().max(600),
  })
  .strict()

export const sourceInputSchema = z
  .object({
    names: z.array(z.string().min(1).max(MAX_SELECTOR_CHARS)).min(1).max(20),
  })
  .strict()

const sourceMatchSchema = z
  .object({
    name: z.string().min(1).max(MAX_SELECTOR_CHARS),
    file: z.string().min(1).max(400),
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
    confidence: z.enum(['map', 'text', 'file']),
  })
  .strict()

export const sourceOutputSchema = z.object({ matches: z.array(sourceMatchSchema).max(20) }).strict()

export const intakeInputSchema = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict()

const unassignedIdSchema = z.string().regex(/^ext_[1-9][0-9]*$/)

export const attachInputSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    ids: z
      .array(z.union([unassignedIdSchema, z.string().regex(/^ann_[1-9][0-9]*$/)]))
      .min(1)
      .max(50),
  })
  .strict()

export const unassignedSchema = z
  .object({
    id: z.string().regex(/^ext_[1-9][0-9]*$/),
    draft: annotationDraftSchema,
    receivedAt: z.number().int().nonnegative(),
    extensionOrigin: z.string().max(200),
  })
  .strict()

export const intakeOutputSchema = z.object({ items: z.array(unassignedSchema).max(100) }).strict()

export const metaSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    token: z.string().min(20).max(200),
    tokenCreatedAt: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    extensionTokenRevokedAt: z.number().int().nonnegative().optional(),
  })
  .strict()

export type Annotation = z.infer<typeof annotationSchema>
export type AnnotationDraft = z.infer<typeof annotationDraftSchema>
export type AnnotationStatus = z.infer<typeof annotationStatusSchema>
export type AnnotationTarget = z.infer<typeof annotationTargetSchema>
export type AnnotationSource = z.infer<typeof annotationSourceSchema>
export type AnnotationCounts = z.infer<typeof annotationCountsSchema>
export type AnnotationKind = z.infer<typeof annotationKindSchema>
export type AnnotationIntent = z.infer<typeof annotationIntentSchema>
export type AnnotationSeverity = z.infer<typeof annotationSeveritySchema>
export type AnnotationSurface = z.infer<typeof annotationSurfaceSchema>
export type AnnotationOrigin = z.infer<typeof annotationOriginSchema>
export type AnnotationThreadMessage = z.infer<typeof annotationThreadMessageSchema>
export type AnnotationStaleReason = z.infer<typeof annotationStaleReasonSchema>
export type UnassignedAnnotation = z.infer<typeof unassignedSchema>
export type AnnotationMeta = z.infer<typeof metaSchema>
export type SourceMatch = z.infer<typeof sourceMatchSchema>
