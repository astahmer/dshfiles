export * as Settings from './settings.js'

import type z from '@deepseek-ai/schemastery'
import { Context, Effect, Layer, Option, Queue, Schema, Stream, SubscriptionRef } from 'effect'
import type { SettingsContract, SettingsValue } from '../settings/types.js'
import { detached } from './detached.js'
import { HostContext, hostService } from './host-context.js'

/** The namespace has no native settings entry yet, or its stored document does not match the plugin's schema. */
export class SettingsUnavailable extends Schema.TaggedError<SettingsUnavailable>()('SettingsUnavailable', {
  namespace: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Settings "${this.namespace}" are unavailable. Match defineSettings.namespace to the native Loader entry id in cordis.patch.yml, then restart DSH.`
  }
}

/** Another writer changed the settings after the revision this update was based on. */
export class SettingsConflict extends Schema.TaggedError<SettingsConflict>()('SettingsConflict', {
  namespace: Schema.String,
  expected: Schema.Number,
  actual: Schema.Number,
}) {
  override get message(): string {
    return `Settings "${this.namespace}" changed (revision ${this.actual}, expected ${this.expected}). Read them again and retry.`
  }
}

/** The settings write was rejected for a reason other than a revision conflict. */
export class SettingsWriteFailed extends Schema.TaggedError<SettingsWriteFailed>()('SettingsWriteFailed', {
  namespace: Schema.String,
  operation: Schema.Literals(['update', 'replace']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Settings "${this.namespace}" could not be saved (${this.operation}).`
  }
}

export interface SettingsSnapshot<Value> {
  readonly value: Value
  readonly revision: number
}

export interface SettingsService<Value extends object> {
  readonly namespace: string
  readonly get: Effect.Effect<Value>
  readonly snapshot: Effect.Effect<SettingsSnapshot<Value>>
  /** The current value, then every committed change. */
  readonly changes: Stream.Stream<Value>
  readonly update: (patch: Partial<Value>, expectedRevision?: number) => Effect.Effect<void, SettingsConflict | SettingsWriteFailed>
  readonly replace: (value: Value, expectedRevision?: number) => Effect.Effect<void, SettingsConflict | SettingsWriteFailed>
}

/** Type-level identity of one settings value; the runtime key is the namespace. */
export interface SettingsOf<Value extends object> {
  readonly settings: Value
}

export type SettingsTag<Value extends object> = Context.Service<SettingsOf<Value>, SettingsService<Value>>

const tags = new Map<string, SettingsTag<object>>()

/** The service key for one namespace; every call with the same namespace returns the same key. */
export const Tag = <Value extends object>(namespace: string): SettingsTag<Value> => {
  const known = tags.get(namespace)
  if (known !== undefined) {
    // SAFETY: the map is keyed by namespace and the value type is the caller's declaration for that namespace.
    return known as unknown as SettingsTag<Value>
  }
  const created = Context.Service<SettingsOf<Value>, SettingsService<Value>>(`@dshfiles/dshx/Settings/${namespace}`)
  // SAFETY: the stored key is only handed back through the cast above, with the caller's value type.
  tags.set(namespace, created as unknown as SettingsTag<object>)
  return created
}

const ConflictCause = Schema.Struct({ code: Schema.Literal('SETTINGS_CONFLICT'), expected: Schema.Number, actual: Schema.Number })

const writeError = (namespace: string, operation: SettingsWriteFailed['operation']) => (cause: unknown) =>
  Option.match(Schema.decodeUnknownOption(ConflictCause)(cause), {
    onNone: () => new SettingsWriteFailed({ namespace, operation, cause }),
    onSome: conflict => new SettingsConflict({ namespace, expected: conflict.expected, actual: conflict.actual }),
  })

/**
 * The live settings of a `defineSettings` contract, read once and refreshed when DSH commits a new revision of this
 * namespace, so `get` never recomposes the profile.
 */
export const layer = <S extends z<any, object>>(
  contract: SettingsContract<S, any>,
): Layer.Layer<SettingsOf<SettingsValue<S>>, SettingsUnavailable, HostContext> => {
  type Value = SettingsValue<S>
  const namespace = contract.namespace
  const service = Tag<Value>(namespace)
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const host = yield* HostContext
      const optionalForms = yield* Effect.option(hostService('settings'))
      const decode = (stored: unknown, revision: number) =>
        Effect.try({
          // SAFETY: SettingsValue only drops the schema's index signature at the type level; the decoded object is unchanged.
          try: (): SettingsSnapshot<Value> => ({ value: contract.schema(stored) as Value, revision }),
          catch: cause => new SettingsUnavailable({ namespace, cause }),
        })
      const read = Effect.gen(function* () {
        const forms = yield* Effect.fromOption(optionalForms).pipe(Effect.mapError(() => new SettingsUnavailable({ namespace })))
        const descriptor = forms.describe().find(item => item.ns === namespace)
        if (descriptor === undefined) return yield* new SettingsUnavailable({ namespace })
        return yield* decode(descriptor.value, descriptor.revision)
      }).pipe(Effect.withSpan('settings read', { attributes: { 'dshx.settings.namespace': namespace } }))
      const initial = yield* read.pipe(
        Effect.catch(error => Effect.logWarning(`${error.message} Using the schema defaults until they load.`).pipe(Effect.andThen(decode({}, 0)))),
      )
      const ref = yield* SubscriptionRef.make(initial)

      const committed = Stream.callback<number>(queue =>
        Effect.acquireRelease(
          Effect.sync(() =>
            host.ctx.on('settings/document-updated', (changed, revision) => {
              if (changed === namespace) Queue.offerUnsafe(queue, revision)
            }),
          ),
          dispose => Effect.sync(dispose),
        ),
      )
      yield* committed.pipe(
        Stream.runForEach(() =>
          read.pipe(
            Effect.flatMap(snapshot => SubscriptionRef.set(ref, snapshot)),
            Effect.catch(error => Effect.logWarning('Settings refresh kept the previous value', error)),
          ),
        ),
        detached,
        Effect.forkScoped,
      )

      return service.of({
        namespace,
        get: Effect.map(SubscriptionRef.get(ref), snapshot => snapshot.value),
        snapshot: SubscriptionRef.get(ref),
        changes: Stream.map(SubscriptionRef.changes(ref), snapshot => snapshot.value),
        update: Effect.fn('settings update')(function* (patch, expectedRevision) {
          const forms = yield* Effect.fromOption(optionalForms).pipe(Effect.mapError(() => new SettingsWriteFailed({ namespace, operation: 'update' })))
          yield* Effect.tryPromise({ try: () => forms.update(namespace, patch, expectedRevision), catch: writeError(namespace, 'update') })
        }),
        replace: Effect.fn('settings replace')(function* (value, expectedRevision) {
          const forms = yield* Effect.fromOption(optionalForms).pipe(Effect.mapError(() => new SettingsWriteFailed({ namespace, operation: 'replace' })))
          yield* Effect.tryPromise({ try: () => forms.replace(namespace, value, expectedRevision), catch: writeError(namespace, 'replace') })
        }),
      })
    }),
  )
}

/** In-memory settings with real revision checks, standing in for DSH's settings forms in tests. */
export const layerTest = <Value extends object>(namespace: string, initial: Value): Layer.Layer<SettingsOf<Value>> => {
  const service = Tag<Value>(namespace)
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make<SettingsSnapshot<Value>>({ value: initial, revision: 0 })
      const write = (next: (current: Value) => Value, expectedRevision: number | undefined) =>
        SubscriptionRef.modify(ref, (current): readonly [Effect.Effect<void, SettingsConflict>, SettingsSnapshot<Value>] =>
          expectedRevision !== undefined && expectedRevision !== current.revision
            ? [Effect.fail(new SettingsConflict({ namespace, expected: expectedRevision, actual: current.revision })), current]
            : [Effect.void, { value: next(current.value), revision: current.revision + 1 }],
        ).pipe(Effect.flatten)
      return service.of({
        namespace,
        get: Effect.map(SubscriptionRef.get(ref), snapshot => snapshot.value),
        snapshot: SubscriptionRef.get(ref),
        changes: Stream.map(SubscriptionRef.changes(ref), snapshot => snapshot.value),
        update: (patch, expectedRevision) => write(current => ({ ...current, ...patch }), expectedRevision),
        replace: (value, expectedRevision) => write(() => value, expectedRevision),
      })
    }),
  )
}
