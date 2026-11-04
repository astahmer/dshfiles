import { homedir } from 'node:os'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, type PlatformError, Random, Schema } from 'effect'
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
const decodeRebaseMetadata = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Union([rebaseTimestampSchema, rebaseMetadataEntrySchema]))),
)
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
    ) => Effect.Effect<number, PlatformError.PlatformError>
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

      const read = Effect.fnUntraced(function* (repoRoot: string) {
        const text = yield* fileSystem.readFileString(yield* timestampFile(repoRoot)).pipe(Effect.option)
        const parsed = Option.flatMap(text, content => decodeRebaseMetadata(content, { onExcessProperty: 'error' }))
        if (Option.isNone(parsed)) return {}
        return Object.fromEntries(
          Object.entries(parsed.value)
            .filter(([name]) => name.startsWith('thread-'))
            .map(([name, value]) => [name, typeof value === 'number' ? { at: value } : value]),
        ) satisfies Readonly<Record<string, RebaseMetadataEntry>>
      })

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
        const existing = yield* read(repoRoot)
        const history = [...integrationHistory(existing[name]), entry].slice(-MAX_INTEGRATION_HISTORY)
        yield* writeAtomically(yield* timestampFile(repoRoot), JSON.stringify({ ...existing, [name]: { ...entry, history } }))
        return at
      })

      return ThreadMetadata.of({ threadsDirectory, read, record, writeAtomically })
    }),
  )
}
