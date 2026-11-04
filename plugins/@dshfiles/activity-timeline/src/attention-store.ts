import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Clock, Context, Effect, Layer, PubSub, Schema, Stream, SynchronizedRef } from 'effect'
import {
  attentionItemSchema,
  type AttentionCounts,
  type AttentionDraft,
  type AttentionItem,
  type AttentionList,
  type AttentionPublish,
  type AttentionView,
} from './attention-api.js'
import { AttentionModel, type UserTransition } from './attention-model.js'

const muteRecordSchema = Schema.Struct({ source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)), mutedAt: Schema.Number })

export const attentionDomain = defineDomain({
  name: 'dshfiles_attention',
  version: 1,
  layout: 'per-record',
  tables: {
    items: { valueSchema: zodSchemaFromEffect(attentionItemSchema), __key: 'items' },
    mutes: { valueSchema: zodSchemaFromEffect(muteRecordSchema), __key: 'mutes' },
  },
})

export class AttentionStorageFailed extends Schema.TaggedError<AttentionStorageFailed>()(
  'AttentionStorageFailed',
  { operation: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'attention-storage-failed' },
) {
  override get message(): string {
    return `The inbox could not ${this.operation} its storage. Retry; if it keeps failing, check the DSH Host log for the storage error.`
  }
}

export class AttentionItemNotFound extends Schema.TaggedError<AttentionItemNotFound>()(
  'AttentionItemNotFound',
  { id: Schema.String },
  { dshxWireCode: 'attention-item-not-found' },
) {
  override get message(): string {
    return `No inbox item ${this.id}. It may have been pruned; read attention_list again for current ids.`
  }
}

export class AttentionTransitionRefused extends Schema.TaggedError<AttentionTransitionRefused>()(
  'AttentionTransitionRefused',
  { id: Schema.String, refusal: Schema.Literals(['resolved', 'snooze-in-past', 'snooze-target-missing']) },
  { dshxWireCode: 'attention-transition-refused' },
) {
  override get message(): string {
    if (this.refusal === 'resolved') return `Inbox item ${this.id} was resolved by its source; it reopens by itself if the source reports it again.`
    if (this.refusal === 'snooze-in-past') return 'Snooze needs a time in the future; pick a later time or snooze until it changes.'
    return 'Snooze needs either `until` (Unix milliseconds) or `untilChange: true`.'
  }
}

export interface AttentionChange {
  readonly revision: number
  readonly counts: AttentionCounts
}

interface InboxState {
  readonly items: ReadonlyMap<string, AttentionItem>
  readonly muted: ReadonlyMap<string, number>
  readonly revision: number
}

/** Per-record keys must be path-safe; a source id carries dots. */
const muteKeyOf = (source: string): string => AttentionModel.itemIdOf('mute', source)

const storageFailed = (operation: string) => (cause: unknown) => new AttentionStorageFailed({ operation, cause })

const make = Effect.gen(function* () {
  const domain = yield* (yield* StorageDomain).open(attentionDomain).pipe(Effect.mapError(storageFailed('open')))
  const items = domain.table('items')
  const mutes = domain.table('mutes')
  const storedItems = yield* items.entries.pipe(Effect.mapError(storageFailed('read')))
  const storedMutes = yield* mutes.entries.pipe(Effect.mapError(storageFailed('read')))
  const startedAt = yield* Clock.currentTimeMillis
  const state = yield* SynchronizedRef.make<InboxState>({
    items: new Map(storedItems),
    muted: new Map(storedMutes.map(([, record]) => [record.source, record.mutedAt])),
    // Monotone across restarts, so a client never mistakes an older list for a newer one.
    revision: startedAt,
  })
  const changes = yield* PubSub.sliding<AttentionChange>(64)

  const mutedSet = (current: InboxState): ReadonlySet<string> => new Set(current.muted.keys())

  /**
   * One change under the mirror's lock: plan against the current state, write durably, then move the mirror and
   * announce it. A plan that changes nothing writes nothing and announces nothing.
   */
  const apply = <A>(
    operation: string,
    plan: (current: InboxState, now: number) => { readonly result: A; readonly put: readonly AttentionItem[]; readonly mute?: { readonly source: string; readonly muted: boolean } },
  ) =>
    SynchronizedRef.modifyEffect(state, current =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const planned = plan(current, now)
        const mute = planned.mute
        const muteChanged = mute !== undefined && current.muted.has(mute.source) !== mute.muted
        if (planned.put.length === 0 && !muteChanged) return [planned.result, current] as const
        const nextItems = new Map(current.items)
        for (const item of planned.put) nextItems.set(item.id, item)
        const pruned = AttentionModel.pruneIds([...nextItems.values()], now)
        for (const id of pruned) nextItems.delete(id)
        yield* Effect.forEach(
          planned.put.filter(item => nextItems.has(item.id)),
          item => items.put(item.id, item),
          { discard: true },
        )
        yield* Effect.forEach(pruned, id => items.delete(id), { discard: true })
        const nextMuted = new Map(current.muted)
        if (mute !== undefined && muteChanged) {
          if (mute.muted) {
            nextMuted.set(mute.source, now)
            yield* mutes.put(muteKeyOf(mute.source), { source: mute.source, mutedAt: now })
          } else {
            nextMuted.delete(mute.source)
            yield* mutes.delete(muteKeyOf(mute.source))
          }
        }
        const next: InboxState = { items: nextItems, muted: nextMuted, revision: Math.max(current.revision + 1, now) }
        yield* PubSub.publish(changes, { revision: next.revision, counts: AttentionModel.countsOf(nextItems.values(), mutedSet(next), now) })
        return [planned.result, next] as const
      }).pipe(Effect.mapError(cause => (cause instanceof AttentionStorageFailed ? cause : new AttentionStorageFailed({ operation, cause })))),
    )

  const list = Effect.fn('attention list')(function* (input: { readonly view: AttentionView; readonly limit: number }) {
    const current = yield* SynchronizedRef.get(state)
    const now = yield* Clock.currentTimeMillis
    const muted = mutedSet(current)
    const result: AttentionList = {
      revision: current.revision,
      view: input.view,
      items: [...AttentionModel.listView({ items: current.items.values(), mutedSources: muted, view: input.view, limit: input.limit, now })],
      counts: AttentionModel.countsOf(current.items.values(), muted, now),
      mutedSources: [...muted].sort(),
    }
    yield* Effect.annotateCurrentSpan({ 'attention.view': input.view, 'attention.items': result.items.length })
    return result
  })

  const get = (id: string) =>
    Effect.flatMap(SynchronizedRef.get(state), current => {
      const item = current.items.get(id)
      return item === undefined ? Effect.fail(new AttentionItemNotFound({ id })) : Effect.succeed(item)
    })

  const publish = Effect.fn('attention publish')(function* (input: AttentionPublish) {
    yield* Effect.annotateCurrentSpan({ 'attention.source': input.source, 'attention.severity': input.severity })
    return yield* apply('write', (current, now) => {
      const outcome = AttentionModel.publish(current.items.get(AttentionModel.itemIdOf(input.source, input.dedupeKey)), input, now)
      return { result: outcome, put: outcome.changed ? [outcome.item] : [] }
    })
  })

  const resolve = Effect.fn('attention resolve')(function* (input: { readonly source: string; readonly dedupeKey: string }) {
    yield* Effect.annotateCurrentSpan({ 'attention.source': input.source })
    return yield* apply('write', (current, now) => {
      const existing = current.items.get(AttentionModel.itemIdOf(input.source, input.dedupeKey))
      if (existing === undefined) return { result: false, put: [] }
      const outcome = AttentionModel.resolve(existing, now)
      return { result: outcome.changed, put: outcome.changed ? [outcome.item] : [] }
    })
  })

  /** State every open item of one source in one change: unlisted open items resolve. */
  const reconcile = Effect.fn('attention reconcile')(function* (input: { readonly source: string; readonly items: ReadonlyArray<AttentionDraft> }) {
    yield* Effect.annotateCurrentSpan({ 'attention.source': input.source, 'attention.items': input.items.length })
    return yield* apply('write', (current, now) => {
      const put: AttentionItem[] = []
      const listed = new Set<string>()
      for (const draft of input.items) {
        const id = AttentionModel.itemIdOf(input.source, draft.dedupeKey)
        listed.add(id)
        const outcome = AttentionModel.publish(current.items.get(id), { source: input.source, ...draft }, now)
        if (outcome.changed) put.push(outcome.item)
      }
      let resolved = 0
      for (const item of current.items.values()) {
        if (item.source !== input.source || listed.has(item.id) || item.resolvedAt !== null) continue
        put.push(AttentionModel.resolve(item, now).item)
        resolved += 1
      }
      return { result: { published: put.length - resolved, resolved }, put }
    })
  })

  type TransitionResult = { readonly kind: 'missing' } | { readonly kind: 'refused'; readonly outcome: Extract<UserTransition, { ok: false }> } | { readonly kind: 'item'; readonly item: AttentionItem }

  const userTransition = Effect.fnUntraced(function* (id: string, transition: (item: AttentionItem, now: number) => UserTransition) {
    const result = yield* apply<TransitionResult>('write', (current, now) => {
      const existing = current.items.get(id)
      if (existing === undefined) return { result: { kind: 'missing' }, put: [] }
      const outcome = transition(existing, now)
      if (!outcome.ok) return { result: { kind: 'refused', outcome }, put: [] }
      return { result: { kind: 'item', item: outcome.item }, put: outcome.changed ? [outcome.item] : [] }
    })
    if (result.kind === 'missing') return yield* new AttentionItemNotFound({ id })
    if (result.kind === 'refused') return yield* new AttentionTransitionRefused({ id, refusal: result.outcome.refusal })
    return result.item
  })

  const done = Effect.fn('attention done')(function* (input: { readonly id: string }) {
    return yield* userTransition(input.id, AttentionModel.done)
  })
  const reopen = Effect.fn('attention reopen')(function* (input: { readonly id: string }) {
    return yield* userTransition(input.id, AttentionModel.reopen)
  })
  const snooze = Effect.fn('attention snooze')(function* (input: { readonly id: string; readonly until?: number; readonly untilChange?: boolean }) {
    const target = { ...(input.until !== undefined && { until: input.until }), ...(input.untilChange !== undefined && { untilChange: input.untilChange }) }
    return yield* userTransition(input.id, (item, now) => AttentionModel.snooze(item, target, now))
  })

  const muteSource = Effect.fn('attention mute source')(function* (input: { readonly source: string; readonly muted: boolean }) {
    yield* Effect.annotateCurrentSpan({ 'attention.source': input.source, 'attention.muted': input.muted })
    yield* apply('write', () => ({ result: undefined, put: [], mute: input }))
    const current = yield* SynchronizedRef.get(state)
    return { mutedSources: [...current.muted.keys()].sort() }
  })

  return AttentionInbox.of({
    list,
    get,
    publish,
    resolve,
    reconcile,
    done,
    snooze,
    reopen,
    muteSource,
    changes: Stream.fromPubSub(changes),
  })
})

type StoreError = AttentionStorageFailed
type UserError = StoreError | AttentionItemNotFound | AttentionTransitionRefused

/** The inbox: one durable set of attention items in the `dshfiles_attention` storage domain, mirrored in memory. */
export class AttentionInbox extends Context.Service<
  AttentionInbox,
  {
    readonly list: (input: { readonly view: AttentionView; readonly limit: number }) => Effect.Effect<AttentionList>
    readonly get: (id: string) => Effect.Effect<AttentionItem, AttentionItemNotFound>
    readonly publish: (input: AttentionPublish) => Effect.Effect<{ readonly item: AttentionItem; readonly changed: boolean }, StoreError>
    readonly resolve: (input: { readonly source: string; readonly dedupeKey: string }) => Effect.Effect<boolean, StoreError>
    readonly reconcile: (input: {
      readonly source: string
      readonly items: ReadonlyArray<AttentionDraft>
    }) => Effect.Effect<{ readonly published: number; readonly resolved: number }, StoreError>
    readonly done: (input: { readonly id: string }) => Effect.Effect<AttentionItem, UserError>
    readonly snooze: (input: { readonly id: string; readonly until?: number; readonly untilChange?: boolean }) => Effect.Effect<AttentionItem, UserError>
    readonly reopen: (input: { readonly id: string }) => Effect.Effect<AttentionItem, UserError>
    readonly muteSource: (input: { readonly source: string; readonly muted: boolean }) => Effect.Effect<{ readonly mutedSources: readonly string[] }, StoreError>
    /** Every committed change with the counts after it. */
    readonly changes: Stream.Stream<AttentionChange>
  }
>()('@dshfiles/activity-timeline/AttentionInbox') {
  static readonly layer = Layer.effect(AttentionInbox, make)
}
