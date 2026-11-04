/**
 * The attention contract: the one inbox every "needs you" signal goes through (plan `plans/ade-ux` §4.8).
 *
 * Providers (agent-questions, thread-sidebar, …) depend on this module and publish items from their Host halves with
 * `createHostApiClient(ctx, attentionApi, packageId)` / `HostApis.client(attentionApi)`. They resolve an item when its
 * underlying state changes, or `reconcile` the whole set of open items of one source after a restart. The inbox
 * (activity-timeline) owns storage, dedupe, snooze, done, mute and the live `changed` event; it never reads a
 * provider's state.
 *
 * This module imports no provider: it is the token both sides share (docs/plugin-boundaries.md).
 */
import { defineApi, event, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** The inbox opened its store: every provider reconciles its open items now. */
    'dshfiles/attention/ready'(payload: { readonly version: 1 }): void
    /**
     * The user chose a provider verb (Answer, Approve, Land, Retry, Resume) on an item of `source`. The provider that
     * owns `source` returns an outcome; one that does not own it returns `undefined` so the next listener answers.
     */
    'dshfiles/attention/act'(request: AttentionActRequest): Promise<AttentionActOutcome | undefined>
    /**
     * The user marked an item Done in the inbox. The provider that owns `item.source` may clear its own matching state
     * (thread-sidebar acknowledges the finished turn, so the row's unread dot goes too); others ignore it.
     */
    'dshfiles/attention/done'(payload: { readonly item: AttentionItem }): void
  }
}

const text = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

/** Fixed severities (plan §4.7): blocking and failed are "Needs you", ready is "Other", info only reaches the Activity log. */
export const ATTENTION_SEVERITIES = ['blocking', 'failed', 'ready', 'info'] as const
export const attentionSeveritySchema = Schema.Literals(ATTENTION_SEVERITIES)
export type AttentionSeverity = typeof attentionSeveritySchema.Type

/** Every verb an item may offer. Open, Done, Snooze and MuteSource are served by the inbox; the rest by the provider. */
export const ATTENTION_VERBS = ['Answer', 'Approve', 'Land', 'Retry', 'Resume', 'Open', 'Done', 'Snooze', 'MuteSource'] as const
export const attentionVerbSchema = Schema.Literals(ATTENTION_VERBS)
export type AttentionVerb = typeof attentionVerbSchema.Type

/** Verbs the provider of an item performs through `act`. */
export const ATTENTION_PROVIDER_VERBS = ['Answer', 'Approve', 'Land', 'Retry', 'Resume'] as const
export const attentionProviderVerbSchema = Schema.Literals(ATTENTION_PROVIDER_VERBS)
export type AttentionProviderVerb = typeof attentionProviderVerbSchema.Type

/** What an item is about, in a form the inbox can link with a native reference. */
export const attentionSubjectSchema = Schema.Struct({
  kind: Schema.Literals(['session', 'backlog-item', 'host', 'workspace', 'revision', 'url']),
  id: text(1, 512),
  /** A human label when the provider knows one; the inbox resolves session titles itself. */
  label: Schema.optionalKey(text(1, 200)),
})
export type AttentionSubject = typeof attentionSubjectSchema.Type

/** One choice an Answer verb can submit in place, such as a question option. */
export const attentionChoiceSchema = Schema.Struct({
  id: text(1, 80),
  label: text(1, 120),
  recommended: Schema.optionalKey(Schema.Boolean),
})
export type AttentionChoice = typeof attentionChoiceSchema.Type

/** A source id: lowercase, dot-separated, owned by one provider (`agent-questions.child-question`). */
export const attentionSourceSchema = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+$/),
)

const uniqueVerbs = Schema.Array(attentionVerbSchema).check(
  Schema.isMaxLength(ATTENTION_VERBS.length),
  Schema.makeFilter(verbs => (new Set(verbs).size === verbs.length ? undefined : 'Verbs must be unique.')),
)

/** What a provider states about one item; the inbox adds identity, lifecycle and timestamps. */
export const attentionDraftSchema = Schema.Struct({
  dedupeKey: text(1, 256).annotate({ description: 'Stable key within the source: a repeat with the same key merges instead of stacking.' }),
  subject: attentionSubjectSchema,
  reason: text(1, 500).annotate({ description: 'Why the user sees this item, in one sentence.' }),
  detail: Schema.optionalKey(text(1, 2000)),
  severity: attentionSeveritySchema,
  verbs: uniqueVerbs,
  choices: Schema.optionalKey(Schema.Array(attentionChoiceSchema).check(Schema.isMaxLength(8))),
})
export type AttentionDraft = typeof attentionDraftSchema.Type

export const attentionPublishSchema = Schema.Struct({ source: attentionSourceSchema, ...attentionDraftSchema.fields })
export type AttentionPublish = typeof attentionPublishSchema.Type

/** One stored inbox item. */
export const attentionItemSchema = Schema.Struct({
  id: text(1, 64),
  source: attentionSourceSchema,
  dedupeKey: text(1, 256),
  subject: attentionSubjectSchema,
  reason: text(1, 500),
  detail: Schema.NullOr(text(1, 2000)),
  severity: attentionSeveritySchema,
  verbs: uniqueVerbs,
  choices: Schema.Array(attentionChoiceSchema).check(Schema.isMaxLength(8)),
  /** What the provider stated last, so an unchanged repeat is a no-op and a changed one can lift a snooze or a Done. */
  fingerprint: text(1, 128),
  createdAt: timestamp,
  /** When the item last became open: first publish, or a publish after it was resolved. */
  openedAt: timestamp,
  updatedAt: timestamp,
  occurrences: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  /** Set by the provider when the underlying state changed; only a new publish reopens it. */
  resolvedAt: Schema.NullOr(timestamp),
  /** Set by the user (Done); Reopen or a changed publish clears it. */
  doneAt: Schema.NullOr(timestamp),
  snoozedUntil: Schema.NullOr(timestamp),
  /** Snoozed until the provider publishes a changed item. */
  snoozeUntilChange: Schema.Boolean,
})
export type AttentionItem = typeof attentionItemSchema.Type

export const ATTENTION_VIEWS = ['needs-you', 'other', 'snoozed', 'closed', 'muted'] as const
export const attentionViewSchema = Schema.Literals(ATTENTION_VIEWS)
export type AttentionView = typeof attentionViewSchema.Type

const countSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const attentionCountsSchema = Schema.Struct({
  needsYou: countSchema,
  blocking: countSchema,
  other: countSchema,
  snoozed: countSchema,
  closed: countSchema,
  muted: countSchema,
})
export type AttentionCounts = typeof attentionCountsSchema.Type

export const attentionListSchema = Schema.Struct({
  revision: countSchema,
  view: attentionViewSchema,
  items: Schema.Array(attentionItemSchema),
  counts: attentionCountsSchema,
  mutedSources: Schema.Array(attentionSourceSchema),
})
export type AttentionList = typeof attentionListSchema.Type

const itemIdSchema = text(1, 64).annotate({ description: 'Inbox item id from attention_list.' })

export const attentionActRequestSchema = Schema.Struct({
  item: attentionItemSchema,
  verb: attentionProviderVerbSchema,
  choiceId: Schema.optionalKey(text(1, 80)),
})
export type AttentionActRequest = typeof attentionActRequestSchema.Type

export const attentionActOutcomeSchema = Schema.Struct({
  ok: Schema.Boolean,
  /** What happened, or why the provider refused, with what the user can do instead. */
  message: text(1, 500),
})
export type AttentionActOutcome = typeof attentionActOutcomeSchema.Type

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const attentionApi = defineApi({
  id: 'attention',
  version: 1,
  owner: '@dshfiles/activity-timeline',
  methods: {
    list: method({
      input: Schema.Struct({
        view: Schema.optionalKey(
          attentionViewSchema.annotate({
            description: 'needs-you (blocking and failed, the default), other (ready), snoozed, closed (done or resolved) or muted.',
          }),
        ),
        limit: Schema.optionalKey(
          Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 200 })).annotate({
            description: 'Maximum items, 1 to 200; defaults to 100.',
          }),
        ),
      }),
      output: attentionListSchema,
      description:
        'List inbox items that need the user: one view at a time plus the count of every view and the muted sources. Needs you = blocking and failed items not done, snoozed, resolved or muted. Read-only.',
      tool: { name: 'attention_list', readOnly: true, render: compactJson },
    }),
    publish: method({
      input: attentionPublishSchema,
      output: Schema.Struct({ item: Schema.NullOr(attentionItemSchema), changed: Schema.Boolean }),
      description:
        'Provider-only: add or merge one item by source and dedupeKey. An unchanged repeat is a no-op; a changed one updates the item and lifts a snooze-until-change or a Done; a publish after resolve reopens it. Info items go to the Activity log only.',
    }),
    resolve: method({
      input: Schema.Struct({ source: attentionSourceSchema, dedupeKey: text(1, 256) }),
      output: Schema.Struct({ resolved: Schema.Boolean }),
      description: 'Provider-only: close one item because its underlying state changed (answered elsewhere, retry passed).',
    }),
    reconcile: method({
      input: Schema.Struct({ source: attentionSourceSchema, items: Schema.Array(attentionDraftSchema).check(Schema.isMaxLength(500)) }),
      output: Schema.Struct({ published: countSchema, resolved: countSchema }),
      description: 'Provider-only: state every open item of one source; open items not listed are resolved. Run after a restart or a missed change.',
    }),
    done: method({
      input: Schema.Struct({ id: itemIdSchema }),
      output: attentionItemSchema,
      description:
        'Mark one inbox item done, so it leaves Needs you and Other until its source publishes a changed state. Reversible with attention_reopen. Run only when the user asked.',
      tool: { name: 'attention_done', readOnly: false, render: compactJson },
    }),
    snooze: method({
      input: Schema.Struct({
        id: itemIdSchema,
        until: Schema.optionalKey(timestamp.annotate({ description: 'Unix milliseconds to snooze until; omit when untilChange is true.' })),
        untilChange: Schema.optionalKey(Schema.Boolean.annotate({ description: 'Snooze until the source publishes a changed state.' })),
      }),
      output: attentionItemSchema,
      description: 'Snooze one inbox item until a time or until its source changes it. Reversible with attention_reopen. Run only when the user asked.',
      tool: { name: 'attention_snooze', readOnly: false, render: compactJson },
    }),
    reopen: method({
      input: Schema.Struct({ id: itemIdSchema }),
      output: attentionItemSchema,
      description: 'Undo Done or Snooze on one inbox item so it shows again. A resolved item cannot be reopened. Run only when the user asked.',
      tool: { name: 'attention_reopen', readOnly: false, render: compactJson },
    }),
    muteSource: method({
      input: Schema.Struct({ source: attentionSourceSchema, muted: Schema.Boolean }),
      output: Schema.Struct({ mutedSources: Schema.Array(attentionSourceSchema) }),
      description:
        'Mute (muted: true) or unmute (muted: false) every inbox item of one source. Muted items stay stored and listed in the muted view. Run only when the user asked.',
      tool: { name: 'attention_mute_source', readOnly: false, render: compactJson },
    }),
    act: method({
      input: Schema.Struct({ id: itemIdSchema, verb: attentionProviderVerbSchema, choiceId: Schema.optionalKey(text(1, 80)) }),
      output: attentionActOutcomeSchema,
      description: "Run a provider verb (Answer, Approve, Land, Retry, Resume) on one item through the plugin that owns the item's source.",
    }),
  },
  events: {
    changed: event({
      schema: Schema.Struct({ revision: countSchema, needsYou: countSchema, blocking: countSchema }),
      description: 'The inbox changed; read the list again. Carries the new Needs you and blocking counts for badges.',
    }),
  },
})
