import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Context, Effect, Layer, Ref, Schema } from 'effect'
import { MAX_VIEWED_MARKS, viewedKey, type ViewedFile, type ViewedMarksSnapshot } from './marks-api.js'

const viewedMarkSchema = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1)),
  version: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
})

export const viewedMarksDomain = defineDomain({
  name: 'diff_viewed',
  version: 1,
  tables: {
    // `defineDomain` still types a table's record validator as a zod schema; the Effect schema stays the source of truth.
    marks: { valueSchema: zodSchemaFromEffect(viewedMarkSchema), __key: 'marks' },
  },
})

export type ViewedMark = typeof viewedMarkSchema.Type

/** A viewed mark could not be stored or removed; the marks the caller saw are unchanged. */
export class ViewedMarksWriteFailed extends Schema.TaggedError<ViewedMarksWriteFailed>()(
  'ViewedMarksWriteFailed',
  { operation: Schema.Literals(['mark', 'unmark']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'viewed-marks-write-failed' },
) {
  override get message(): string {
    return `The file could not be ${this.operation === 'mark' ? 'marked' : 'unmarked'} as viewed. Retry, or reload the page if storage was restarted.`
  }
}

/** Monotone across Host restarts: a new mark always outranks every stored version. */
const nextMarkVersion = (current: number, now: number): number => Math.max(current + 1, now)

const byVersionAscending = (left: ViewedMark, right: ViewedMark): number => left.version - right.version

/** Keys to drop once the store exceeds its bound; the least recently written marks go first. */
const markKeysToTrim = (marks: readonly ViewedMark[], limit = MAX_VIEWED_MARKS): readonly string[] =>
  [...marks]
    .sort(byVersionAscending)
    .slice(0, Math.max(0, marks.length - limit))
    .map(mark => mark.key)

interface MarksState {
  readonly revision: number
  readonly records: ReadonlyMap<string, ViewedMark>
}

const snapshotOf = (state: MarksState): ViewedMarksSnapshot => ({
  revision: state.revision,
  marks: [...state.records.values()].sort(byVersionAscending).map(mark => mark.key),
})

/** The reviewed files of every Session, stored durably in the Host's `diff_viewed` domain. */
export class ViewedMarks extends Context.Service<
  ViewedMarks,
  {
    readonly snapshot: Effect.Effect<ViewedMarksSnapshot>
    readonly toggle: (file: ViewedFile) => Effect.Effect<ViewedMarksSnapshot, ViewedMarksWriteFailed>
  }
>()('@dshfiles/diff-viewed/ViewedMarks') {
  static readonly nextVersion = nextMarkVersion
  static readonly keysToTrim = markKeysToTrim

  /** The marks of a store that keeps at most `bound` of them, dropping the least recently written first. */
  static readonly layerWithBound = (bound: number) =>
    Layer.effect(
      ViewedMarks,
      Effect.gen(function* () {
        const storage = yield* StorageDomain
        const domain = yield* storage.open(viewedMarksDomain)
        const table = domain.table('marks')
        const stored = yield* table.entries
        const startedAt = yield* Clock.currentTimeMillis
        const state = yield* Ref.make<MarksState>({
          revision: Math.max(startedAt, ...stored.map(([, mark]) => mark.version)),
          records: new Map(stored),
        })

        const unmark = Effect.fnUntraced(function* (key: string) {
          yield* table.delete(key).pipe(Effect.mapError(cause => new ViewedMarksWriteFailed({ operation: 'unmark', cause })))
          return yield* Ref.updateAndGet(state, current => {
            const records = new Map(current.records)
            records.delete(key)
            return { ...current, records }
          })
        })

        const mark = Effect.fnUntraced(function* (key: string) {
          const now = yield* Clock.currentTimeMillis
          const current = yield* Ref.get(state)
          const added: ViewedMark = { key, version: nextMarkVersion(current.revision, now) }
          yield* table.put(key, added).pipe(Effect.mapError(cause => new ViewedMarksWriteFailed({ operation: 'mark', cause })))
          const records = new Map(current.records).set(key, added)
          const trimmed = markKeysToTrim([...records.values()], bound)
          for (const trimmedKey of trimmed) records.delete(trimmedKey)
          yield* Ref.set(state, { revision: added.version, records })
          yield* Effect.forEach(trimmed, trimmedKey => table.delete(trimmedKey), { discard: true }).pipe(
            Effect.catchTag('StorageDomainWriteFailed', error => Effect.logWarning('Trimming old viewed marks failed', error)),
          )
          return yield* Ref.get(state)
        })

        const toggle = Effect.fn('diff viewed mark toggle')(function* (file: ViewedFile) {
          const key = viewedKey(file)
          const current = yield* Ref.get(state)
          return snapshotOf(current.records.has(key) ? yield* unmark(key) : yield* mark(key))
        }, domain.withWriteLock)

        return ViewedMarks.of({ snapshot: Effect.map(Ref.get(state), snapshotOf), toggle })
      }),
    )

  static readonly layer = ViewedMarks.layerWithBound(MAX_VIEWED_MARKS)
}
