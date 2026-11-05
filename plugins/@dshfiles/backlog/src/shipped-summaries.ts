import { createHash } from 'node:crypto'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'
import { SqlSchema } from 'effect/sql'
import { BacklogDb } from './backlog-db.js'
import { BacklogReference } from './backlog-reference.js'
import { LlmCompletionFailed, ShippedSummaryEmpty, ShippedSummaryUnconfigured } from './errors.js'
import { type ShippedBucket, type ShippedDigest, type ShippedPeriod, type ShippedQuery } from './shipped.js'
import { BacklogStore } from './store.js'
import { Triage } from './triage-service.js'

const MAX_SUMMARY_CHARS = 2_000

export interface ShippedSummary {
  readonly text: string
  readonly generatedAt: number
  readonly provider: string
  readonly model: string
  /** The items in the bucket changed since it was written: it still shows, with a prompt to regenerate. */
  readonly stale: boolean
}

export type ShippedDigestWithSummaries = Omit<ShippedDigest, 'buckets'> & {
  readonly buckets: readonly (ShippedBucket & { readonly summary: ShippedSummary | null })[]
}

export interface SummarizeShippedInput {
  readonly period: ShippedPeriod
  readonly start: number
  readonly end: number
  readonly projects?: readonly (string | null)[] | undefined
  readonly regenerate?: boolean | undefined
}

const SummaryRow = Schema.Struct({
  cache_key: Schema.String,
  items_hash: Schema.String,
  summary: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  generated_at: Schema.Number,
})

const projectsKey = (projects: readonly (string | null)[] | undefined): string =>
  JSON.stringify([...new Set((projects ?? []).map(project => project ?? ''))].sort())

/** One cached summary per period, bucket start and project filter; the items hash says whether it is still current. */
const cacheKeyOf = (input: { readonly period: ShippedPeriod; readonly start: number; readonly projects?: readonly (string | null)[] | undefined }): string =>
  `${input.period}:${String(input.start)}:${projectsKey(input.projects)}`

const itemsHashOf = (bucket: ShippedBucket): string =>
  createHash('sha256')
    .update(
      bucket.projects
        .flatMap(group => group.items.map(item => `${BacklogReference.refOf(item)}\u0000${String(item.doneAt)}\u0000${item.title}`))
        .sort()
        .join('\n'),
    )
    .digest('hex')

const systemPrompt = [
  'You write a short "what shipped" update for a developer from the backlog items they finished in one period.',
  'Answer in plain Markdown: one sentence of overview, then at most five bullets that group related items by theme or project.',
  'Name items by their b:ref. Use only what the list says; never invent work, numbers or impact. No heading, no preamble.',
].join(' ')

const modelInputOf = (bucket: ShippedBucket): string =>
  [
    `Period: ${new Date(bucket.start).toISOString()} to ${new Date(bucket.end).toISOString()}`,
    `Shipped: ${String(bucket.count)} (previous period: ${String(bucket.previousCount)})`,
    ...bucket.projects.flatMap(group => [
      `Project ${group.project ?? '(none)'}:`,
      ...group.items.map(
        item =>
          `- ${BacklogReference.labelOf(item)} [${item.kind}] ${item.title}${item.pullRequests.length > 0 ? ` (PR ${item.pullRequests.join(', ')})` : ''}${item.summary === undefined ? '' : `: ${item.summary.replace(/\s+/g, ' ').slice(0, 400)}`}`,
      ),
    ]),
  ].join('\n')

/**
 * Optional short AI summaries of a shipped bucket: generated on demand with the triage model and cached in the backlog
 * database per period, bucket and project filter, so reopening the view never calls the model again.
 */
export class ShippedSummaries extends Context.Service<
  ShippedSummaries,
  {
    /** The digest with each bucket's cached summary, marked stale when the bucket's items changed since. */
    readonly digest: (query: ShippedQuery) => Effect.Effect<ShippedDigestWithSummaries, unknown>
    /** A bucket's summary: the cached one while its items are unchanged, otherwise (or on `regenerate`) a new model call. */
    readonly summarize: (
      input: SummarizeShippedInput,
    ) => Effect.Effect<ShippedSummary & { readonly cached: boolean }, ShippedSummaryUnconfigured | ShippedSummaryEmpty | LlmCompletionFailed | unknown>
  }
>()('@dshfiles/backlog/ShippedSummaries') {
  static readonly layer = Layer.effect(
    ShippedSummaries,
    Effect.gen(function* () {
      const sql = yield* BacklogDb
      const store = yield* BacklogStore
      const triage = yield* Triage

      const findRows = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: SummaryRow,
        execute: keys => sql`SELECT * FROM shipped_summaries WHERE ${sql.in('cache_key', keys)}`,
      })
      const findRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: SummaryRow,
        execute: key => sql`SELECT * FROM shipped_summaries WHERE cache_key = ${key}`,
      })

      const summaryOf = (row: typeof SummaryRow.Type, bucket: ShippedBucket): ShippedSummary => ({
        text: row.summary,
        generatedAt: row.generated_at,
        provider: row.provider,
        model: row.model,
        stale: row.items_hash !== itemsHashOf(bucket),
      })

      const digest = Effect.fn('backlog shipped digest')(function* (query: ShippedQuery) {
        const shipped = yield* store.shipped(query)
        const keyed = shipped.buckets.map(bucket => ({ bucket, key: cacheKeyOf({ period: query.period, start: bucket.start, projects: query.projects }) }))
        const rows = keyed.length === 0 ? [] : yield* findRows(keyed.map(entry => entry.key))
        const byKey = new Map(rows.map(row => [row.cache_key, row]))
        return {
          ...shipped,
          buckets: keyed.map(entry => {
            const row = byKey.get(entry.key)
            return { ...entry.bucket, summary: row === undefined || entry.bucket.count === 0 ? null : summaryOf(row, entry.bucket) }
          }),
        }
      })

      const summarize = Effect.fn('backlog shipped summary')(function* (input: SummarizeShippedInput) {
        const shipped = yield* store.shipped({ period: 'custom', from: input.start, to: input.end, projects: input.projects })
        const bucket = shipped.buckets[0]
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.shipped.period': input.period, 'dshx.backlog.shipped.items': bucket?.count ?? 0 })
        if (bucket === undefined || bucket.count === 0) return yield* new ShippedSummaryEmpty()
        const key = cacheKeyOf(input)
        const hash = itemsHashOf(bucket)
        const cached = yield* findRow(key)
        yield* Effect.annotateCurrentSpan({
          'dshx.backlog.shipped.cached': Option.isSome(cached) && cached.value.items_hash === hash && input.regenerate !== true,
        })
        if (Option.isSome(cached) && cached.value.items_hash === hash && input.regenerate !== true) return { ...summaryOf(cached.value, bucket), cached: true }
        const model = yield* triage.model
        if (Option.isNone(model)) return yield* new ShippedSummaryUnconfigured()
        const answer = yield* model.value.complete({ system: systemPrompt, input: modelInputOf(bucket), maxTokens: 400 })
        const text = answer.trim().slice(0, MAX_SUMMARY_CHARS)
        if (text === '') return yield* new LlmCompletionFailed({ provider: model.value.provider, model: model.value.model })
        const generatedAt = yield* Clock.currentTimeMillis
        yield* sql`INSERT INTO shipped_summaries (cache_key, items_hash, summary, provider, model, generated_at)
          VALUES (${key}, ${hash}, ${text}, ${model.value.provider}, ${model.value.model}, ${generatedAt})
          ON CONFLICT (cache_key) DO UPDATE SET items_hash = excluded.items_hash, summary = excluded.summary, provider = excluded.provider,
            model = excluded.model, generated_at = excluded.generated_at`
        return { text, generatedAt, provider: model.value.provider, model: model.value.model, stale: false, cached: false }
      })

      return ShippedSummaries.of({ digest, summarize })
    }),
  )

  static readonly cacheKeyOf = cacheKeyOf
}
