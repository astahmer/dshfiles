import * as Schema from 'effect/Schema'

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

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const nonNegativeInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const positiveInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const annotationIdSchema = Schema.String.check(Schema.isPattern(/^ann_[1-9][0-9]*$/u))
const unassignedIdSchema = Schema.String.check(Schema.isPattern(/^ext_[1-9][0-9]*$/u))

const annotationStatusSchema = Schema.Literals(['pending', 'acknowledged', 'resolved', 'dismissed', 'stale'])
const annotationIntentSchema = Schema.Literals(['fix', 'change', 'question', 'approve'])
const annotationSeveritySchema = Schema.Literals(['blocking', 'important', 'suggestion'])
const annotationSurfaceSchema = Schema.Literals(['dsh', 'preview', 'external'])
const annotationKindSchema = Schema.Literals(['element', 'region', 'text'])
const annotationStaleReasonSchema = Schema.Literals(['element-missing', 'text-changed', 'route-changed'])
const annotationOriginSchema = Schema.Literals(['dsh', 'extension'])

const annotationRectSchema = Schema.Struct({
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  width: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
})

const annotationSourceSchema = Schema.Struct({
  file: boundedString(1, 400),
  line: positiveInt,
  column: nonNegativeInt,
  confidence: Schema.Literals(['map', 'text', 'file']),
})

export const annotationTargetSchema = Schema.Struct({
  surface: annotationSurfaceSchema,
  url: Schema.String.check(Schema.isMaxLength(MAX_URL_CHARS)),
  selector: boundedString(1, MAX_SELECTOR_CHARS),
  tag: boundedString(1, 40),
  text: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_TEXT_CHARS))),
  attributes: Schema.optionalKey(Schema.Record(Schema.String.check(Schema.isMaxLength(60)), Schema.String.check(Schema.isMaxLength(MAX_ATTRIBUTE_CHARS)))),
  styles: Schema.optionalKey(Schema.Record(Schema.String.check(Schema.isMaxLength(40)), Schema.String.check(Schema.isMaxLength(120)))),
  rect: annotationRectSchema,
  source: Schema.optionalKey(annotationSourceSchema),
  staleReason: Schema.optionalKey(annotationStaleReasonSchema),
})

const annotationThreadMessageSchema = Schema.Struct({
  id: boundedString(1, 40),
  role: Schema.Literals(['human', 'agent']),
  body: boundedString(1, MAX_NOTE_CHARS),
  at: nonNegativeInt,
})

export const annotationSchema = Schema.Struct({
  id: annotationIdSchema,
  sessionId: boundedString(1, 200),
  revision: positiveInt,
  status: annotationStatusSchema,
  kind: annotationKindSchema,
  target: annotationTargetSchema,
  note: Schema.String.check(Schema.isMaxLength(MAX_NOTE_CHARS)),
  intent: Schema.optionalKey(annotationIntentSchema),
  severity: Schema.optionalKey(annotationSeveritySchema),
  thread: Schema.Array(annotationThreadMessageSchema).check(Schema.isMaxLength(MAX_THREAD_MESSAGES)),
  createdAt: nonNegativeInt,
  updatedAt: nonNegativeInt,
  resolvedAt: Schema.optionalKey(nonNegativeInt),
  resolvedBy: Schema.optionalKey(Schema.Literals(['human', 'agent'])),
  resolution: Schema.optionalKey(
    Schema.Struct({
      revision: positiveInt,
      summary: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_NOTE_CHARS))),
    }),
  ),
  origin: annotationOriginSchema,
})

export const annotationDraftSchema = Schema.Struct({
  kind: annotationKindSchema,
  target: annotationTargetSchema,
  note: Schema.String.check(Schema.isMaxLength(MAX_NOTE_CHARS)),
  intent: Schema.optionalKey(annotationIntentSchema),
  severity: Schema.optionalKey(annotationSeveritySchema),
})

const annotationCountsSchema = Schema.Struct({
  pending: nonNegativeInt,
  acknowledged: nonNegativeInt,
  stale: nonNegativeInt,
  resolved: nonNegativeInt,
  dismissed: nonNegativeInt,
})

export const createInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  items: Schema.Array(annotationDraftSchema).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ITEMS_PER_CREATE)),
  origin: Schema.optionalKey(annotationOriginSchema),
})

export const listInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  statuses: Schema.optionalKey(Schema.Array(annotationStatusSchema).check(Schema.isMaxLength(5))),
  limit: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))),
})

export const shownOutputSchema = Schema.Struct({
  annotations: Schema.Array(annotationSchema).check(Schema.isMaxLength(200)),
  counts: annotationCountsSchema,
})

export const ackInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  ids: Schema.Array(annotationIdSchema).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
})

export const resolveInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  id: annotationIdSchema,
  revision: positiveInt,
  summary: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_NOTE_CHARS))),
})

export const dismissInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  id: annotationIdSchema,
  reason: boundedString(1, MAX_NOTE_CHARS),
})

export const staleInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  id: annotationIdSchema,
  reason: annotationStaleReasonSchema,
})

export const replyInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  id: annotationIdSchema,
  body: boundedString(1, MAX_NOTE_CHARS),
  role: Schema.optionalKey(Schema.Literals(['human', 'agent'])),
})

export const previewInputSchema = Schema.Struct({ path: boundedString(1, 400) })

export const previewOutputSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), path: Schema.String, html: Schema.String, truncated: Schema.Boolean }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.Literals(['outside-workspace', 'unsupported', 'missing', 'too-large']) }),
])

const chromePageSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(200)),
  title: Schema.String.check(Schema.isMaxLength(400)),
  url: Schema.String.check(Schema.isMaxLength(600)),
})

export const chromeStatusOutputSchema = Schema.Struct({
  running: Schema.Boolean,
  endpoint: Schema.String.check(Schema.isMaxLength(200)),
  executable: Schema.String.check(Schema.isMaxLength(400)),
  pages: Schema.Array(chromePageSchema).check(Schema.isMaxLength(50)),
})

export const chromePickInputSchema = Schema.Struct({ pageId: Schema.optionalKey(boundedString(1, 200)) })

export const chromePickOutputSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    target: annotationTargetSchema,
    point: Schema.Struct({ x: Schema.Number.check(Schema.isFinite()), y: Schema.Number.check(Schema.isFinite()) }),
  }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.Literals(['cancelled', 'timeout', 'unavailable', 'no-page']) }),
])

export const pairInputSchema = Schema.Struct({ action: Schema.Literals(['arm', 'status']) })

export const pairOutputSchema = Schema.Struct({
  armed: Schema.Boolean,
  expiresAt: Schema.optionalKey(nonNegativeInt),
  pairedAt: Schema.optionalKey(nonNegativeInt),
})

export const setupOutputSchema = Schema.Struct({
  extensionPath: Schema.String.check(Schema.isMaxLength(400)),
  extensionId: Schema.String.check(Schema.isMaxLength(64)),
  chromePath: Schema.String.check(Schema.isMaxLength(400)),
  pickActiveTab: Schema.Boolean,
  startUrl: Schema.String.check(Schema.isMaxLength(600)),
})

export const sourceInputSchema = Schema.Struct({
  names: Schema.Array(boundedString(1, MAX_SELECTOR_CHARS)).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
})

const sourceMatchSchema = Schema.Struct({
  name: boundedString(1, MAX_SELECTOR_CHARS),
  file: boundedString(1, 400),
  line: positiveInt,
  column: nonNegativeInt,
  confidence: Schema.Literals(['map', 'text', 'file']),
})

export const sourceOutputSchema = Schema.Struct({ matches: Schema.Array(sourceMatchSchema).check(Schema.isMaxLength(20)) })

export const intakeInputSchema = Schema.Struct({
  limit: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))),
})

export const attachInputSchema = Schema.Struct({
  sessionId: boundedString(1, 200),
  ids: Schema.Array(Schema.Union([unassignedIdSchema, annotationIdSchema])).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
})

export const unassignedSchema = Schema.Struct({
  id: unassignedIdSchema,
  draft: annotationDraftSchema,
  receivedAt: nonNegativeInt,
  extensionOrigin: Schema.String.check(Schema.isMaxLength(200)),
})

export const intakeOutputSchema = Schema.Struct({ items: Schema.Array(unassignedSchema).check(Schema.isMaxLength(100)) })

export const metaSchema = Schema.Struct({
  schemaVersion: positiveInt,
  token: boundedString(20, 200),
  tokenCreatedAt: nonNegativeInt,
  sequence: nonNegativeInt,
  extensionTokenRevokedAt: Schema.optionalKey(nonNegativeInt),
})

export type Annotation = typeof annotationSchema.Type
export type AnnotationDraft = typeof annotationDraftSchema.Type
export type AnnotationStatus = typeof annotationStatusSchema.Type
export type AnnotationTarget = typeof annotationTargetSchema.Type
export type AnnotationSource = typeof annotationSourceSchema.Type
export type AnnotationCounts = typeof annotationCountsSchema.Type
export type AnnotationKind = typeof annotationKindSchema.Type
export type AnnotationIntent = typeof annotationIntentSchema.Type
export type AnnotationSeverity = typeof annotationSeveritySchema.Type
export type AnnotationSurface = typeof annotationSurfaceSchema.Type
export type AnnotationOrigin = typeof annotationOriginSchema.Type
export type AnnotationThreadMessage = typeof annotationThreadMessageSchema.Type
export type AnnotationStaleReason = typeof annotationStaleReasonSchema.Type
export type UnassignedAnnotation = typeof unassignedSchema.Type
export type AnnotationMeta = typeof metaSchema.Type
export type SourceMatch = typeof sourceMatchSchema.Type
