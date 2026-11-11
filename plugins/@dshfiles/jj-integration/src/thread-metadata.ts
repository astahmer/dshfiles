import { homedir } from 'node:os'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, type PlatformError, Random, Schema, Semaphore } from 'effect'
import { WorkspaceFilesFailed } from './errors.js'
import { JjSettings } from './jj-settings.js'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'

const rebaseTimestampSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
const metadataIdentifierSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const integrationRecordSchema = Schema.Struct({
  at: rebaseTimestampSchema,
  tipChangeId: Schema.optional(metadataIdentifierSchema),
  baseChangeId: Schema.optional(metadataIdentifierSchema),
  sessionId: Schema.optional(metadataIdentifierSchema),
})
const rebaseMetadataEntrySchema = Schema.Struct({
  at: rebaseTimestampSchema,
  tipChangeId: Schema.optional(metadataIdentifierSchema),
  baseChangeId: Schema.optional(metadataIdentifierSchema),
  sessionId: Schema.optional(metadataIdentifierSchema),
  history: Schema.optional(Schema.Array(integrationRecordSchema)),
})
const storedMetadataSchema = Schema.Record(Schema.String, Schema.Unknown)
const decodeMetadataFile = Schema.decodeUnknownOption(Schema.fromJsonString(storedMetadataSchema))
const decodeMetadataEntry = Schema.decodeUnknownOption(Schema.Union([rebaseTimestampSchema, rebaseMetadataEntrySchema]))
export type RebaseMetadataEntry = typeof rebaseMetadataEntrySchema.Type
export type IntegrationRecord = typeof integrationRecordSchema.Type
/** A thread lands again and again while it keeps working; the oldest landings stop mattering long before this many. */
const MAX_INTEGRATION_HISTORY = 50

// An entry written before the history existed only knows its latest land.
const integrationHistory = (metadata: RebaseMetadataEntry | undefined): readonly IntegrationRecord[] => {
  if (metadata === undefined) return []
  if (metadata.history !== undefined) return metadata.history
  return [
    {
      at: metadata.at,
      ...(metadata.tipChangeId === undefined ? undefined : { tipChangeId: metadata.tipChangeId }),
      ...(metadata.baseChangeId === undefined ? undefined : { baseChangeId: metadata.baseChangeId }),
      ...(metadata.sessionId === undefined ? undefined : { sessionId: metadata.sessionId }),
    },
  ]
}

const randomHex = (bytes: number): Effect.Effect<string> =>
  Effect.map(Effect.all(Array.from({ length: bytes }, () => Random.nextIntBetween(0, 255))), values =>
    values.map(value => value.toString(16).padStart(2, '0')).join(''),
  )

/**
 * What every thread-workspace backend shares regardless of VCS: where thread workspaces live, and the land records
 * kept beside them (`.dshfiles-rebase-timestamps.json`), so a git and a jj repository report review ranges alike.
 */
export class ThreadMetadata extends Context.Service<
  ThreadMetadata,
  {
    readonly threadsDirectory: (repoRoot: string) => Effect.Effect<string>
    readonly read: (repoRoot: string) => Effect.Effect<Readonly<Record<string, RebaseMetadataEntry>>>
    /** Append one land to a thread's history; returns its timestamp. */
    readonly record: (
      repoRoot: string,
      name: string,
      input: { readonly tipChangeId: string | undefined; readonly baseChangeId: string | undefined; readonly sessionId: string | undefined },
    ) => Effect.Effect<number, PlatformError.PlatformError | WorkspaceFilesFailed>
    readonly writeAtomically: (target: string, text: string) => Effect.Effect<void, PlatformError.PlatformError>
  }
>()('@dshfiles/jj-integration/ThreadMetadata') {
  static readonly integrationHistory = integrationHistory
  static readonly randomHex = randomHex

  static readonly layer = Layer.effect(
    ThreadMetadata,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const settings = yield* JjSettings

      const threadsDirectory = Effect.fnUntraced(function* (repoRoot: string) {
        const configured = (yield* settings.get).threadsDirectory.trim()
        if (configured === '') return ThreadWorkspaceModel.defaultThreadsDirectory(repoRoot)
        const expanded = configured.startsWith('~/') ? path.join(homedir(), configured.slice(2)) : configured
        return path.join(expanded, path.basename(repoRoot))
      })

      const timestampFile = (repoRoot: string) => Effect.map(threadsDirectory(repoRoot), directory => path.join(directory, '.dshfiles-rebase-timestamps.json'))
      const recording = yield* Semaphore.make(1)

      /** The file as stored, bad entries included, so a write never drops what it could not decode. */
      const readStored = Effect.fnUntraced(function* (file: string) {
        if (!(yield* fileSystem.exists(file))) return {}
        const parsed = decodeMetadataFile(yield* fileSystem.readFileString(file))
        if (Option.isNone(parsed)) {
          return yield* new WorkspaceFilesFailed({ detail: `${file} is not a JSON object of land records. Fix or remove it, then land again.` })
        }
        return parsed.value
      })

      const entriesOf = (stored: typeof storedMetadataSchema.Type): Readonly<Record<string, RebaseMetadataEntry>> =>
        Object.fromEntries(
          Object.entries(stored).flatMap(([name, value]) => {
            if (!name.startsWith('thread-')) return []
            const entry = decodeMetadataEntry(value, { onExcessProperty: 'error' })
            if (Option.isNone(entry)) return []
            return [[name, typeof entry.value === 'number' ? { at: entry.value } : entry.value]]
          }),
        )

      const read = (repoRoot: string) =>
        timestampFile(repoRoot).pipe(
          Effect.flatMap(readStored),
          Effect.map(entriesOf),
          Effect.orElseSucceed(() => ({})),
        )

      const writeAtomically = Effect.fnUntraced(function* (target: string, text: string) {
        const temporaryPath = `${target}.${yield* randomHex(4)}.tmp`
        yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true })
        yield* fileSystem.writeFileString(temporaryPath, text)
        yield* fileSystem.rename(temporaryPath, target)
      })

      const record = Effect.fnUntraced(function* (
        repoRoot: string,
        name: string,
        input: { readonly tipChangeId: string | undefined; readonly baseChangeId: string | undefined; readonly sessionId: string | undefined },
      ) {
        const at = yield* Clock.currentTimeMillis
        const entry: IntegrationRecord = {
          at,
          ...(input.tipChangeId !== undefined && { tipChangeId: input.tipChangeId }),
          ...(input.baseChangeId !== undefined && { baseChangeId: input.baseChangeId }),
          ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
        }
        const file = yield* timestampFile(repoRoot)
        const stored = yield* readStored(file)
        const history = [...integrationHistory(entriesOf(stored)[name]), entry].slice(-MAX_INTEGRATION_HISTORY)
        yield* writeAtomically(file, JSON.stringify({ ...stored, [name]: { ...entry, history } }))
        return at
      })

      return ThreadMetadata.of({ threadsDirectory, read, record: (...input) => recording.withPermits(1)(record(...input)), writeAtomically })
    }),
  )
}
