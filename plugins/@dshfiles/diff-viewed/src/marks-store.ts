import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Context, Effect, Layer, Ref, Schema } from 'effect'
import {
  MAX_RANGE_MARKS,
  MAX_VIEWED_MARKS,
  viewedKey,
  ViewedKeys,
  type RangeMarks,
  type ViewedFile,
  type ViewedMarksSnapshot,
  type ViewedRange,
  type ViewedTarget,
} from './marks-api.js'

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

const isRangeMark = (mark: ViewedMark): boolean => ViewedKeys.rangeFromKey(mark.key) !== null

/** Turn marks only: the native review tab polls this, and a thread review's range marks would only weigh it down. */
const snapshotOf = (state: MarksState): ViewedMarksSnapshot => ({
  revision: state.revision,
  marks: [...state.records.values()]
    .filter(mark => !isRangeMark(mark))
    .sort(byVersionAscending)
    .map(mark => mark.key),
})

const rangeMarksOf = (state: MarksState, range: ViewedRange): RangeMarks => {
  const paths: { readonly path: string; readonly version: number }[] = []
  for (const mark of state.records.values()) {
    const parsed = ViewedKeys.rangeFromKey(mark.key)
    if (parsed !== null && parsed.workspacePath === range.workspacePath && parsed.base === range.base && parsed.head === range.head)
      paths.push({ path: parsed.path, version: mark.version })
  }
  return { revision: state.revision, paths: paths.sort((left, right) => left.version - right.version).map(entry => entry.path) }
}

/** Keys past each kind's bound; turn and range marks are trimmed separately so one cannot evict the other. */
const keysOverBounds = (records: ReadonlyMap<string, ViewedMark>, bounds: { readonly turn: number; readonly range: number }): readonly string[] => {
  const turn: ViewedMark[] = []
  const range: ViewedMark[] = []
  for (const mark of records.values()) (isRangeMark(mark) ? range : turn).push(mark)
  return [...markKeysToTrim(turn, bounds.turn), ...markKeysToTrim(range, bounds.range)]
}

/** Every viewed mark (per turn and per revision range), stored durably in the Host's `diff_viewed` domain. */
export class ViewedMarks extends Context.Service<
  ViewedMarks,
  {
    readonly snapshot: Effect.Effect<ViewedMarksSnapshot>
    readonly toggle: (file: ViewedFile) => Effect.Effect<ViewedMarksSnapshot, ViewedMarksWriteFailed>
    readonly rangeState: (range: ViewedRange) => Effect.Effect<RangeMarks>
    readonly set: (input: {
      readonly targets: readonly ViewedTarget[]
      readonly viewed: boolean
    }) => Effect.Effect<{ readonly revision: number; readonly changed: number }, ViewedMarksWriteFailed>
  }
>()('@dshfiles/diff-viewed/ViewedMarks') {
  static readonly nextVersion = nextMarkVersion
  static readonly keysToTrim = markKeysToTrim

  /** The marks of a store that keeps at most `bound` turn marks (and `rangeBound` range marks), dropping the least recently written first. */
  static readonly layerWithBound = (bound: number, rangeBound: number = MAX_RANGE_MARKS) =>
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
        const bounds = { turn: bound, range: rangeBound }

        const unmark = Effect.fnUntraced(function* (key: string) {
          yield* table.delete(key).pipe(Effect.mapError(cause => new ViewedMarksWriteFailed({ operation: 'unmark', cause })))
          return yield* Ref.updateAndGet(state, current => {
            const records = new Map(current.records)
            records.delete(key)
            return { ...current, records }
          })
        })

        /** Drop the keys past each bound from `records` and return them, so the table can delete them too. */
        const trim = (records: Map<string, ViewedMark>): readonly string[] => {
          const trimmed = keysOverBounds(records, bounds)
          for (const trimmedKey of trimmed) records.delete(trimmedKey)
          return trimmed
        }

        const deleteTrimmed = (trimmed: readonly string[]) =>
          Effect.forEach(trimmed, trimmedKey => table.delete(trimmedKey), { discard: true }).pipe(
            Effect.catchTag('StorageDomainWriteFailed', error => Effect.logWarning('Trimming old viewed marks failed', error)),
          )

        const mark = Effect.fnUntraced(function* (key: string) {
          const now = yield* Clock.currentTimeMillis
          const current = yield* Ref.get(state)
          const added: ViewedMark = { key, version: nextMarkVersion(current.revision, now) }
          yield* table.put(key, added).pipe(Effect.mapError(cause => new ViewedMarksWriteFailed({ operation: 'mark', cause })))
          const records = new Map(current.records).set(key, added)
          const trimmed = trim(records)
          yield* Ref.set(state, { revision: added.version, records })
          yield* deleteTrimmed(trimmed)
          return yield* Ref.get(state)
        })

        const toggle = Effect.fn('diff viewed mark toggle')(function* (file: ViewedFile) {
          const key = viewedKey(file)
          const current = yield* Ref.get(state)
          return snapshotOf(current.records.has(key) ? yield* unmark(key) : yield* mark(key))
        }, domain.withWriteLock)

        const set = Effect.fn('diff viewed marks set')(function* (input: { readonly targets: readonly ViewedTarget[]; readonly viewed: boolean }) {
          const now = yield* Clock.currentTimeMillis
          const current = yield* Ref.get(state)
          const records = new Map(current.records)
          const keys = [...new Set(input.targets.map(ViewedKeys.target))].filter(key => input.viewed !== records.has(key))
          let version = current.revision
          const added: ViewedMark[] = []
          for (const key of keys) {
            version = nextMarkVersion(version, now)
            added.push({ key, version })
          }
          const changed = keys.length
          if (input.viewed)
            yield* Effect.forEach(added, mark => table.put(mark.key, mark), { discard: true }).pipe(
              Effect.mapError(cause => new ViewedMarksWriteFailed({ operation: 'mark', cause })),
            )
          else
            yield* Effect.forEach(keys, key => table.delete(key), { discard: true }).pipe(
              Effect.mapError(cause => new ViewedMarksWriteFailed({ operation: 'unmark', cause })),
            )
          for (const mark of added) if (input.viewed) records.set(mark.key, mark)
          if (!input.viewed) for (const key of keys) records.delete(key)
          if (changed === 0) return { revision: current.revision, changed }
          // An unmark-only write still moves the revision, so a client never keeps a newer read over this one.
          const revision = input.viewed ? version : nextMarkVersion(current.revision, now)
          const trimmed = trim(records)
          yield* Ref.set(state, { revision, records })
          yield* deleteTrimmed(trimmed)
          return { revision, changed }
        }, domain.withWriteLock)

        return ViewedMarks.of({
          snapshot: Effect.map(Ref.get(state), snapshotOf),
          toggle,
          rangeState: range => Effect.map(Ref.get(state), current => rangeMarksOf(current, range)),
          set,
        })
      }),
    )

  static readonly layer = ViewedMarks.layerWithBound(MAX_VIEWED_MARKS)
}
