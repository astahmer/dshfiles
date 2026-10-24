import { z } from 'zod'

export const ALERT_KINDS = ['error-rate', 'latency', 'throughput', 'span-count', 'duration'] as const
export const alertKindSchema = z.enum(ALERT_KINDS)
export type AlertKind = z.infer<typeof alertKindSchema>

export const alertSeveritySchema = z.enum(['info', 'warning', 'critical'])
export type AlertSeverity = z.infer<typeof alertSeveritySchema>

export const alertComparatorSchema = z.enum(['above', 'below'])
export type AlertComparator = z.infer<typeof alertComparatorSchema>

export const ALERT_PERCENTILES = [50, 90, 95, 99] as const
export const alertPercentileSchema = z.union([z.literal(50), z.literal(90), z.literal(95), z.literal(99)])

export const MAX_ALERT_RULES = 50
export const MAX_ALERT_WINDOW_MINUTES = 24 * 60

/** Which spans a rule counts; every set field must match. */
export const spanFilterSchema = z
  .object({
    service: z.string().trim().min(1).max(256).nullable().describe('Only spans of this service.name; null for any service.'),
    operation: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .nullable()
      .describe('Span name: exact, or a prefix when it ends with * (e.g. "chat *", "jj *"); null for any span.'),
    attribute: z
      .object({
        key: z
          .string()
          .regex(/^[\w.:/-]{1,128}$/)
          .describe('Attribute key, e.g. gen_ai.provider.name.'),
        value: z.string().max(512).describe('Exact value compared as text, or * for any value (the key is present).'),
      })
      .strict()
      .nullable()
      .describe('Only spans whose attribute has this value; null for no attribute filter.'),
  })
  .strict()
export type SpanFilter = z.infer<typeof spanFilterSchema>

export const alertRuleDraftSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .optional()
      .describe('Existing rule id to update; omit to create a rule.'),
    name: z.string().trim().min(1).max(120),
    kind: alertKindSchema.describe(
      'error-rate: share of matching spans that failed (threshold 0 to 1). latency: the percentile duration in ms. throughput: matching spans per minute. span-count: matching spans in the window. duration: any matching span longer than threshold ms.',
    ),
    filter: spanFilterSchema,
    windowMinutes: z.number().int().min(1).max(MAX_ALERT_WINDOW_MINUTES).describe('Spans that ended within this many minutes count.'),
    threshold: z.number().nonnegative().max(1e12),
    comparator: alertComparatorSchema.describe('Fire when the value is above or below the threshold; duration rules always fire above.'),
    percentile: alertPercentileSchema.describe('Latency rules: which percentile; ignored by other kinds.'),
    minSamples: z
      .number()
      .int()
      .min(1)
      .max(100_000)
      .describe('Error-rate and latency rules stay quiet with fewer matching spans than this, so one failure is not 100%.'),
    severity: alertSeveritySchema,
    enabled: z.boolean(),
    notify: z.boolean().describe('Show an in-app banner (and a browser notification when allowed) when the rule fires.'),
    markThreads: z.boolean().describe('Mark the threads whose spans tripped the rule (dsh.session.id) unread in the thread sidebar.'),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.kind === 'error-rate' && draft.threshold > 1)
      context.addIssue({ code: 'custom', path: ['threshold'], message: 'An error-rate threshold is a share between 0 and 1.' })
  })
export type AlertRuleDraft = z.infer<typeof alertRuleDraftSchema>

export const alertRuleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: alertKindSchema,
    filter: spanFilterSchema,
    windowMinutes: z.number().int().positive(),
    threshold: z.number(),
    comparator: alertComparatorSchema,
    percentile: alertPercentileSchema,
    minSamples: z.number().int().positive(),
    severity: alertSeveritySchema,
    enabled: z.boolean(),
    notify: z.boolean(),
    markThreads: z.boolean(),
    mutedUntil: z.number().nullable().describe('While set and in the future, the rule still evaluates but delivers nothing.'),
    builtin: z.boolean().describe('Shipped with the plugin; editable and removable like any rule.'),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict()
export type AlertRule = z.infer<typeof alertRuleSchema>

export const alertStatusSchema = z.enum(['ok', 'firing'])
export type AlertStatus = z.infer<typeof alertStatusSchema>

export const alertStateSchema = z
  .object({
    status: alertStatusSchema,
    since: z.number().nullable().describe('When the current firing started; null while ok.'),
    value: z.number().nullable().describe('The last evaluated value; null when no span matched.'),
    sampleCount: z.number().int().nonnegative(),
    evaluatedAt: z.number().nullable(),
    clearEvaluations: z.number().int().nonnegative().describe('Consecutive evaluations under the threshold while firing.'),
  })
  .strict()
export type AlertState = z.infer<typeof alertStateSchema>

export const alertEventSchema = z
  .object({
    id: z.number().int().positive(),
    ruleId: z.string(),
    ruleName: z.string(),
    severity: alertSeveritySchema,
    kind: z.enum(['firing', 'resolved']),
    reason: z.enum(['threshold', 'disabled', 'removed']),
    at: z.number(),
    value: z.number().nullable(),
    threshold: z.number(),
    sampleCount: z.number().int().nonnegative(),
    sessionIds: z.array(z.string()).describe('Threads (dsh.session.id) whose spans tripped the rule, at most 10.'),
    sampleTraceId: z.string().nullable(),
    muted: z.boolean(),
    notify: z.boolean().describe('Whether clients should announce this event.'),
    threadsMarked: z.number().int().nonnegative(),
    deliveryError: z.string().nullable(),
  })
  .strict()
export type AlertEvent = z.infer<typeof alertEventSchema>

export const alertRuleViewSchema = alertRuleSchema.extend({ state: alertStateSchema }).strict()
export type AlertRuleView = z.infer<typeof alertRuleViewSchema>

export const alertsSnapshotSchema = z
  .object({
    rules: z.array(alertRuleViewSchema),
    firing: z.number().int().nonnegative(),
    history: z.array(alertEventSchema),
    latestEventId: z.number().int().nonnegative(),
    lastEvaluatedAt: z.number().nullable(),
    intervalSeconds: z.number().int().positive(),
  })
  .strict()
export type AlertsSnapshot = z.infer<typeof alertsSnapshotSchema>

export const alertFeedSchema = z
  .object({
    latestEventId: z.number().int().nonnegative(),
    firing: z.number().int().nonnegative(),
    events: z.array(alertEventSchema),
  })
  .strict()
export type AlertFeed = z.infer<typeof alertFeedSchema>

export const evaluationSummarySchema = z
  .object({
    evaluatedAt: z.number(),
    evaluated: z.number().int().nonnegative(),
    transitions: z.number().int().nonnegative(),
    firing: z.number().int().nonnegative(),
  })
  .strict()
export type EvaluationSummary = z.infer<typeof evaluationSummarySchema>
