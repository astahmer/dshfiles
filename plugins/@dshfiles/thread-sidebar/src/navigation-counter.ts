import { Clock, Context, Effect, Layer, Schema, Semaphore } from 'effect'
import { DESTINATION_IDS, type DestinationId } from './destination-ids.js'
import { NAVIGATION_SURFACES, type NavigationCounts, type NavigationRecord } from './navigation-api.js'
import { StateFiles } from './runtime-files.js'
import { RuntimeStateFailed } from './sidebar-errors.js'

const NAVIGATION_FILE = 'thread-sidebar-navigation.json'
/** Sections kept; the least recently opened go first. Ids are short, so the file stays a few kilobytes. */
const MAX_SECTIONS = 200

const count = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
const entry = Schema.Struct({ opens: count, lastOpenedAt: count })
const documentSchema = Schema.Struct({
  version: Schema.Literal(1),
  since: count,
  destinations: Schema.Record(Schema.String, entry),
  /** `destination/panelId` → counts. */
  sections: Schema.Record(Schema.String, entry),
  surfaces: Schema.Record(Schema.String, count),
})
type NavigationDocument = typeof documentSchema.Type
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(documentSchema))

const empty = (now: number): NavigationDocument => ({ version: 1, since: now, destinations: {}, sections: {}, surfaces: {} })

/** Apply one open to the counts. Pure, so the test pins the arithmetic without a file. */
const apply = (document: NavigationDocument, record: NavigationRecord, now: number): NavigationDocument => {
  const destination = document.destinations[record.destination]
  const sections = { ...document.sections }
  if (record.section !== undefined) {
    const key = `${record.destination}/${record.section}`
    sections[key] = { opens: (sections[key]?.opens ?? 0) + 1, lastOpenedAt: now }
  }
  const kept = Object.entries(sections)
    .sort(([, left], [, right]) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MAX_SECTIONS)
  return {
    ...document,
    destinations: { ...document.destinations, [record.destination]: { opens: (destination?.opens ?? 0) + 1, lastOpenedAt: now } },
    sections: Object.fromEntries(kept),
    surfaces: { ...document.surfaces, [record.surface]: (document.surfaces[record.surface] ?? 0) + 1 },
  }
}

/** The wire shape: every destination and surface listed, sections by opens. */
const present = (document: NavigationDocument): NavigationCounts => ({
  since: document.since,
  destinations: DESTINATION_IDS.map(destination => ({
    destination,
    opens: document.destinations[destination]?.opens ?? 0,
    lastOpenedAt: document.destinations[destination]?.lastOpenedAt ?? null,
  })),
  sections: Object.entries(document.sections)
    .flatMap(([key, value]) => {
      const separator = key.indexOf('/')
      const destination = key.slice(0, separator)
      if (separator < 1 || !(DESTINATION_IDS as readonly string[]).includes(destination)) return []
      // SAFETY: checked against DESTINATION_IDS on the line above.
      return [{ destination: destination as DestinationId, section: key.slice(separator + 1), opens: value.opens, lastOpenedAt: value.lastOpenedAt }]
    })
    .sort((left, right) => right.opens - left.opens || left.section.localeCompare(right.section)),
  surfaces: NAVIGATION_SURFACES.map(surface => ({ surface, opens: document.surfaces[surface] ?? 0 })),
})

/** The navigation counts, in one owner-only runtime file of this Host. */
export class NavigationCounter extends Context.Service<
  NavigationCounter,
  {
    readonly record: (input: NavigationRecord) => Effect.Effect<void, RuntimeStateFailed>
    readonly counts: Effect.Effect<NavigationCounts, RuntimeStateFailed>
    readonly reset: Effect.Effect<NavigationCounts, RuntimeStateFailed>
  }
>()('@dshfiles/thread-sidebar/NavigationCounter') {
  static readonly applyRecord = apply
  static readonly present = present

  static readonly layer = Layer.effect(
    NavigationCounter,
    Effect.gen(function* () {
      const files = yield* StateFiles
      const path = files.runtimePath(NAVIGATION_FILE)
      const exclusive = (yield* Semaphore.make(1)).withPermits(1)
      const read = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const text = yield* files
          .read({ path, missing: '' })
          .pipe(Effect.mapError(cause => new RuntimeStateFailed({ file: 'navigation', operation: 'read', cause })))
        // A missing or unreadable counter starts over: it holds no state anything else depends on.
        return text === '' ? empty(now) : yield* decode(text).pipe(Effect.orElseSucceed(() => empty(now)))
      })
      const write = (document: NavigationDocument) =>
        files
          .write({ path, text: `${JSON.stringify(document)}\n` })
          .pipe(Effect.mapError(cause => new RuntimeStateFailed({ file: 'navigation', operation: 'write', cause })))
      return NavigationCounter.of({
        record: Effect.fn('navigation record')(function* (input) {
          yield* exclusive(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              yield* write(apply(yield* read, input, now))
            }),
          )
        }),
        counts: exclusive(read).pipe(Effect.map(present), Effect.withSpan('navigation counts')),
        reset: exclusive(
          Effect.gen(function* () {
            const next = empty(yield* Clock.currentTimeMillis)
            yield* write(next)
            return present(next)
          }),
        ).pipe(Effect.withSpan('navigation reset')),
      })
    }),
  )
}
