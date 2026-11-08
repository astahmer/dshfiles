import { randomBytes } from 'node:crypto'
import type { StorageListInput, StoredEntry } from '@dshfiles/dshx/api'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { Context, Effect, Layer, Option, Schema, Semaphore, Stream } from 'effect'
import { automationRecordSchema, runRecordSchema, type AutomationRecord, type RunRecord } from './automations-api.js'

export const NAMESPACE = '@dshfiles/project-automations'
const AUTOMATION_PREFIX = 'automation/'
const RUN_PREFIX = 'run/'
/** Runs kept per automation; older ones are deleted as new ones are recorded. */
export const RUNS_KEPT = 25

const decodeAutomation = Schema.decodeUnknownOption(automationRecordSchema)
const decodeRun = Schema.decodeUnknownOption(runRecordSchema)
const encodeAutomation = Schema.encodeSync(Schema.toCodecJson(automationRecordSchema))
const encodeRun = Schema.encodeSync(Schema.toCodecJson(runRecordSchema))

/** The automations' own storage namespace failed; nothing was changed by the failed call. */
export class AutomationStorageFailure extends Schema.TaggedError<AutomationStorageFailure>()(
  'AutomationStorageFailure',
  { operation: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'automation-storage-failure' },
) {
  override get message(): string {
    return 'The automations storage could not be read or written. Check that the DSH storage-domain plugin is loaded, then try again.'
  }
}

const automationKey = (id: string) => `${AUTOMATION_PREFIX}${id}`
const runPrefix = (automationId: string) => `${RUN_PREFIX}${automationId}/`
/** Zero-padded start time first, so a prefix listing is chronological. */
const runKey = (run: RunRecord) => `${runPrefix(run.automationId)}${String(run.startedAt).padStart(15, '0')}-${run.id}`

export const newAutomationId = (): string => `auto_${randomBytes(12).toString('base64url')}`
export const newRunId = (): string => `run_${randomBytes(9).toString('base64url')}`

const make = Effect.gen(function* () {
  const storage = yield* PluginStorage
  /** One writer at a time, so the scheduler committing a next target never interleaves with an edit. */
  const lock = yield* Semaphore.make(1)
  const failed = (operation: string) => (cause: unknown) => new AutomationStorageFailure({ operation, cause })

  const listEntries = Effect.fn('automation store list')(function* (prefix: string) {
    const out: StoredEntry[] = []
    let cursor: string | undefined
    do {
      const input: StorageListInput = cursor === undefined ? { prefix, limit: 500 } : { prefix, limit: 500, cursor }
      const page = yield* storage.list(input).pipe(Effect.mapError(failed('list')))
      out.push(...page.entries)
      cursor = page.cursor ?? undefined
    } while (cursor !== undefined)
    return out
  })

  const decodeAll = <A>(entries: readonly StoredEntry[], decode: (entry: StoredEntry) => Option.Option<A>) => {
    const out: A[] = []
    for (const entry of entries) Option.match(decode(entry), { onNone: () => undefined, onSome: value => out.push(value) })
    return out
  }

  const automations = listEntries(AUTOMATION_PREFIX).pipe(
    Effect.map(entries => decodeAll(entries, entry => decodeAutomation(entry.value)).toSorted((a, b) => a.createdAt - b.createdAt)),
  )

  const get = (id: string) =>
    storage.get(automationKey(id)).pipe(
      Effect.map(entry => Option.flatMap(entry, stored => decodeAutomation(stored.value))),
      Effect.mapError(failed('get')),
    )

  const put = (record: AutomationRecord) => storage.set(automationKey(record.id), encodeAutomation(record)).pipe(Effect.asVoid, Effect.mapError(failed('set')))

  /** Runs newest first: of one automation, or of every automation. */
  const runs = Effect.fn('automation store runs')(function* (input: { readonly automationId?: string | undefined; readonly limit: number }) {
    const entries = yield* listEntries(input.automationId === undefined ? RUN_PREFIX : runPrefix(input.automationId))
    // The key starts with the zero-padded start time, so the newest runs are the last keys: history older than the
    // requested rows is never decoded.
    const newest = entries.toSorted((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)).slice(0, input.limit)
    return decodeAll(newest, entry => decodeRun(entry.value)).toSorted((a, b) => b.startedAt - a.startedAt)
  })

  const recordRun = Effect.fn('automation store record run')(function* (run: RunRecord) {
    yield* storage.set(runKey(run), encodeRun(run)).pipe(Effect.mapError(failed('record-run')))
    const page = yield* storage.list({ prefix: runPrefix(run.automationId), limit: 500 }).pipe(Effect.mapError(failed('prune-runs')))
    const excess = page.entries.length - RUNS_KEPT
    for (const entry of page.entries.slice(0, Math.max(0, excess))) yield* storage.delete(entry.key).pipe(Effect.mapError(failed('prune-runs')))
  })

  const remove = Effect.fn('automation store delete')(function* (id: string) {
    const existed = yield* storage.delete(automationKey(id)).pipe(Effect.mapError(failed('delete')))
    let cursor: string | undefined
    do {
      const page = yield* storage.list({ prefix: runPrefix(id), limit: 500 }).pipe(Effect.mapError(failed('delete-runs')))
      for (const entry of page.entries) yield* storage.delete(entry.key).pipe(Effect.mapError(failed('delete-runs')))
      cursor = page.cursor ?? undefined
    } while (cursor !== undefined)
    return existed
  })

  return AutomationStore.of({
    automations,
    get,
    put,
    remove,
    runs,
    recordRun,
    exclusive: lock.withPermits(1),
    changes: storage.changes(AUTOMATION_PREFIX).pipe(Stream.as(undefined)),
  })
})

/** Automations and their run history in the plugin's storage namespace, which survives Host restarts. */
export class AutomationStore extends Context.Service<
  AutomationStore,
  {
    readonly automations: Effect.Effect<readonly AutomationRecord[], AutomationStorageFailure>
    readonly get: (id: string) => Effect.Effect<Option.Option<AutomationRecord>, AutomationStorageFailure>
    readonly put: (record: AutomationRecord) => Effect.Effect<void, AutomationStorageFailure>
    readonly remove: (id: string) => Effect.Effect<boolean, AutomationStorageFailure>
    readonly runs: (input: {
      readonly automationId?: string | undefined
      readonly limit: number
    }) => Effect.Effect<readonly RunRecord[], AutomationStorageFailure>
    readonly recordRun: (run: RunRecord) => Effect.Effect<void, AutomationStorageFailure>
    /** Run a read-modify-write of automation records without another writer in between. */
    readonly exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    /** Fires after any automation record is written or deleted, by this Host or a browser. */
    readonly changes: Stream.Stream<void>
  }
>()('@dshfiles/project-automations/AutomationStore') {
  static readonly layer = Layer.effect(AutomationStore, make).pipe(Layer.provide(PluginStorage.layerFor(NAMESPACE)))
}
