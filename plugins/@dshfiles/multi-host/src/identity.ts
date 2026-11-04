import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect'
import { IdentityCorrupt, IdentityPathInvalid, IdentityUnreadable, IdentityWriteFailed, ProfileMismatch, ProfileUnavailable } from './errors.js'
import { MultiHostPaths } from './paths.js'
import { PrivateFile } from './private-file.js'
import { runtimeIdentitySchema, type RuntimeIdentity as RuntimeIdentityValue } from './records.js'

const persistedIdentitySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runtimeId: Schema.String.check(Schema.isUUID()),
  profile: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
})
type PersistedIdentity = Schema.Schema.Type<typeof persistedIdentitySchema>
const profileSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))

const decodePersisted = Schema.decodeUnknownEffect(Schema.fromJsonString(persistedIdentitySchema), { onExcessProperty: 'error' })
const decodeProfile = Schema.decodeUnknownOption(profileSchema)
const decodeVersion = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)) })),
)
const decodeIdentity = Schema.decodeUnknownEffect(runtimeIdentitySchema, { onExcessProperty: 'error' })

/** The profile the DSH CLI was launched with: `--profile`, `-p` or its first positional argument. */
const launchedProfile = (argv: readonly string[]): string | undefined => {
  const valueOptions = new Set(['--port', '--host', '--cwd'])
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (argument === '--profile' || argument === '-p') {
      const profile = argv[index + 1]
      if (profile !== undefined && profile.trim() !== '') return profile.trim()
      index += 1
      continue
    }
    if (argument.startsWith('--profile=')) return argument.slice('--profile='.length)
    if (valueOptions.has(argument)) {
      index += 1
      continue
    }
    if (!argument.startsWith('-')) return argument
  }
  return undefined
}

export type RuntimeIdentityError = IdentityPathInvalid | IdentityUnreadable | IdentityCorrupt | IdentityWriteFailed | ProfileUnavailable | ProfileMismatch

/** This runtime's stable identity: one runtime id per DSH profile, persisted privately under the plugin data. */
export class RuntimeIdentity extends Context.Service<RuntimeIdentity, { readonly current: Effect.Effect<RuntimeIdentityValue, RuntimeIdentityError> }>()(
  '@dshfiles/multi-host/RuntimeIdentity',
) {
  /** `configuredProfile` is the plugin's `profile` setting, checked against the profile DSH was launched with. */
  static readonly layer = (input: { readonly configuredProfile: string | undefined }) =>
    Layer.effect(
      RuntimeIdentity,
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const paths = yield* MultiHostPaths
        const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
          effect.pipe(Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, path))

        const environmentProfile = yield* Config.option(
          Config.NonEmptyString('DSH_PROFILE').pipe(Config.orElse(() => Config.NonEmptyString('DSH_PROFILE_NAME'))),
        )
        const discoveredProfile = Option.getOrUndefined(environmentProfile)?.trim() || launchedProfile(process.argv)

        const dshVersion = yield* Effect.try(() => createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')).pipe(
          Effect.flatMap(packagePath => fileSystem.readFileString(packagePath)),
          Effect.map(text => Option.match(decodeVersion(text), { onNone: () => 'unknown', onSome: value => value.version })),
          Effect.orElseSucceed(() => 'unknown'),
        )

        const readPersisted = Effect.fnUntraced(function* (file: string) {
          const state = yield* provided(PrivateFile.secure(file)).pipe(Effect.mapError(cause => new IdentityUnreadable({ cause })))
          if (state === 'invalid') return yield* new IdentityPathInvalid()
          const text = yield* provided(PrivateFile.readIfPresent(file)).pipe(Effect.mapError(cause => new IdentityUnreadable({ cause })))
          if (text === undefined) return undefined
          return yield* decodePersisted(text).pipe(Effect.mapError(() => new IdentityCorrupt()))
        })

        const persist = (persistInput: { readonly file: string; readonly value: PersistedIdentity }) =>
          provided(PrivateFile.write({ path: persistInput.file, body: `${JSON.stringify(persistInput.value, null, 2)}\n`, commit: 'link' })).pipe(
            Effect.mapError(cause => new IdentityWriteFailed({ cause })),
          )

        /** A concurrent writer may have linked its identity first; that one wins. */
        const create = Effect.fnUntraced(function* (createInput: { readonly file: string; readonly profile: string }) {
          const proposed: PersistedIdentity = { schemaVersion: 1, runtimeId: randomUUID(), profile: createInput.profile }
          return yield* persist({ file: createInput.file, value: proposed }).pipe(
            Effect.as(proposed),
            Effect.catchTag('IdentityWriteFailed', error =>
              Effect.flatMap(readPersisted(createInput.file), winner => (winner === undefined ? Effect.fail(error) : Effect.succeed(winner))),
            ),
          )
        })

        const current = Effect.gen(function* () {
          const reported = discoveredProfile ?? input.configuredProfile?.trim()
          if (reported === undefined || reported.length === 0) return yield* new ProfileUnavailable()
          if (discoveredProfile !== undefined && input.configuredProfile !== undefined && discoveredProfile !== input.configuredProfile) {
            return yield* new ProfileMismatch({ reason: 'setting' })
          }
          const profile = Option.getOrUndefined(decodeProfile(reported))
          if (profile === undefined) return yield* new ProfileUnavailable()
          const file = paths.dataPath(path.join('runtime-identities', `${profile}.json`))
          const persisted = (yield* readPersisted(file)) ?? (yield* create({ file, profile }))
          if (persisted.profile !== profile) return yield* new ProfileMismatch({ reason: 'recorded' })
          return yield* decodeIdentity({
            protocolVersion: 1,
            runtimeId: persisted.runtimeId,
            profile: persisted.profile,
            homeLeaf: path.basename(paths.dshHome),
            dshVersion,
            capabilities: ['workspace', 'session', 'agent'],
          }).pipe(Effect.orDie)
        }).pipe(Effect.withSpan('multi-host identity read'))

        return RuntimeIdentity.of({ current })
      }).pipe(Effect.orDie),
    )
}
