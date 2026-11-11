import { homedir } from 'node:os'
import { Context, Duration, Effect, FileSystem, Layer, Path, Schema, Semaphore, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import {
  PackPlan,
  type PackAction,
  type PackOutcome,
  type PackPreview,
  type PluginEntryFact,
  type StepResult,
  type StepStatus,
  type Toolchain,
} from './pack-plan.js'

const MAX_DETAIL = 300
const INSTALL_TIMEOUT = Duration.minutes(5)
const DSHX_BIN = ['tooling', 'dshx', 'packages', 'dshx', 'dist', 'cli', 'bin.js'] as const
const PROFILE_SYNC = ['scripts', 'profile-sync.ts'] as const
const SELF = '@dshfiles/onboarding'

/** What these controls read of the plugin manager; `PluginManager` satisfies it with its branded entry ids. */
export interface PackManagerSurface<Id extends string> {
  listPlugins(): Promise<readonly { readonly entryId: Id; readonly moduleName: string; readonly enabled: boolean; readonly readOnlyReason?: string }[]>
  setPluginEnabled(
    id: Id,
    enabled: boolean,
  ): Promise<{
    readonly changed: boolean
    readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
    readonly restartReason?: string
    readonly error?: { readonly code: string; readonly diagnostic?: string }
  }>
  /** Absent on a manager without bundle records: the toolchain then cannot be located. */
  listBundles?(): Promise<readonly { readonly name: string; readonly source?: string }[]>
}

/** The profile the Host booted: its name for commands, its home only ever passed to dshx, never shown. */
export interface BootProfile {
  readonly name: string
  readonly home: string
}

/** `dshx add --json`'s envelope; only the fields read here. */
const addEnvelopeSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    data: Schema.Struct({ files: Schema.Array(Schema.Unknown), restart: Schema.NullOr(Schema.String), warnings: Schema.Array(Schema.String) }),
  }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ message: Schema.String, hint: Schema.String }) }),
])
const decodeEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(addEnvelopeSchema))

type ResolvedToolchain =
  | { readonly kind: 'automatic'; readonly root: string; readonly bin: string; readonly profile: BootProfile }
  | Extract<Toolchain, { kind: 'manual' }>

const STATUS_RANK = { applied: 0, 'restart-required': 1, overridden: 2, cancelled: 3, manual: 4, failed: 5 } satisfies Record<StepStatus, number>

export class PackControls extends Context.Service<
  PackControls,
  {
    /** The owned plugins' Loader entries; null when this Host serves no plugin manager or it failed to answer. */
    readonly entries: Effect.Effect<readonly PluginEntryFact[] | null>
    readonly preview: (input: {
      readonly pack: string
      readonly action: PackAction
      readonly prerequisites: ReadonlyMap<string, 'done' | 'todo' | 'unknown' | 'off'>
    }) => Effect.Effect<PackPreview>
    /** Recomputes the preview, then works through it (or the named plugins of it) one plugin at a time. */
    readonly apply: (input: {
      readonly pack: string
      readonly action: PackAction
      readonly prerequisites: ReadonlyMap<string, 'done' | 'todo' | 'unknown' | 'off'>
      readonly plugins?: readonly string[] | undefined
    }) => Effect.Effect<PackOutcome>
  }
>()('@dshfiles/onboarding/PackControls') {
  static readonly layerFrom = <Id extends string>(input: {
    readonly manager: () => PackManagerSurface<Id> | undefined
    readonly profile: () => BootProfile | undefined
    /** `DSH_HOME` is set, so a copied command passes `--home "$DSH_HOME"` instead of a path. */
    readonly homeFromEnv: boolean
    readonly nodeExecutable: string
  }) =>
    Layer.effect(
      PackControls,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const lock = yield* Semaphore.make(1)

        const rows = Effect.suspend(() => {
          const manager = input.manager()
          return manager === undefined ? Effect.succeed(null) : Effect.tryPromise(() => manager.listPlugins()).pipe(Effect.orElseSucceed(() => null))
        })
        const entries = Effect.map(rows, listed => (listed === null ? null : PackPlan.entriesOf(listed)))

        const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false))

        /** The checkout this bundle is linked from, read off the plugin manager's record of it; nothing is assumed. */
        const toolchain = Effect.gen(function* (): Effect.fn.Return<ResolvedToolchain> {
          const profile = input.profile()
          if (profile === undefined) return { kind: 'manual', reason: 'This Host was not started from a DSH profile it can name.' }
          const manager = input.manager()
          const bundles = yield* Effect.tryPromise(() => manager?.listBundles?.() ?? Promise.resolve([])).pipe(Effect.orElseSucceed(() => []))
          const source = bundles.find(bundle => bundle.name === SELF)?.source?.replace(/^(link|file):/u, '')
          const unlinked = 'This profile does not link Getting started from a dshfiles checkout, so the repository toolchain is not on this Host.'
          if (source === undefined || !path.isAbsolute(source)) return { kind: 'manual', reason: unlinked }
          const root = path.resolve(source, '..', '..', '..')
          const bin = path.join(root, ...DSHX_BIN)
          if (!(yield* exists(path.join(root, ...PROFILE_SYNC)))) return { kind: 'manual', reason: unlinked }
          if (!(yield* exists(bin)))
            return {
              kind: 'manual',
              reason: 'The dshfiles checkout has no built dshx CLI. Run pnpm exec turbo run build --filter=@dshfiles/dshx there first.',
            }
          return { kind: 'automatic', root, bin, profile }
        })

        const planWith = (request: {
          readonly pack: string
          readonly action: PackAction
          readonly prerequisites: ReadonlyMap<string, 'done' | 'todo' | 'unknown' | 'off'>
        }) =>
          Effect.gen(function* () {
            const [listed, resolved] = yield* Effect.all([entries, toolchain], { concurrency: 'unbounded' })
            const plan = PackPlan.preview({
              ...request,
              entries: listed,
              toolchain: resolved.kind === 'automatic' ? { kind: 'automatic' } : resolved,
              profile: input.profile()?.name ?? null,
              homeFromEnv: input.homeFromEnv,
            })
            return { plan, toolchain: resolved }
          })

        const preview = Effect.fn('onboarding pack preview')(function* (request: {
          readonly pack: string
          readonly action: PackAction
          readonly prerequisites: ReadonlyMap<string, 'done' | 'todo' | 'unknown' | 'off'>
        }) {
          yield* Effect.annotateCurrentSpan({ 'onboarding.pack': request.pack, 'onboarding.pack.action': request.action })
          return (yield* planWith(request)).plan
        })

        /** Paths of this machine never reach a result: the checkout and the DSH home are named, not printed. */
        const redact = (text: string, resolved: ResolvedToolchain): string => {
          let redacted = text
          if (resolved.kind === 'automatic') redacted = redacted.replaceAll(resolved.root, '<dshfiles checkout>').replaceAll(resolved.profile.home, '$DSH_HOME')
          return redacted.replaceAll(homedir(), '~').slice(0, MAX_DETAIL)
        }

        const install = Effect.fn('onboarding dshx add')(function* (plugin: string, resolved: Extract<ResolvedToolchain, { kind: 'automatic' }>) {
          yield* Effect.annotateCurrentSpan({ 'onboarding.plugin': plugin, 'process.executable.name': 'dshx' })
          const command = ChildProcess.make(
            input.nodeExecutable,
            [resolved.bin, 'add', `@dshfiles/${plugin}`, '--profile', resolved.profile.name, '--home', resolved.profile.home, '--json'],
            { cwd: resolved.root, stdin: 'ignore', forceKillAfter: Duration.seconds(2) },
          )
          const run = Effect.scoped(
            Effect.gen(function* () {
              const process = yield* spawner.spawn(command)
              const [stdout, , exitCode] = yield* Effect.all(
                [Stream.mkString(Stream.decodeText(process.stdout)), Stream.runDrain(process.stderr), process.exitCode],
                { concurrency: 'unbounded' },
              )
              return { stdout, exitCode }
            }),
          )
          const result = yield* run.pipe(
            Effect.timeoutOrElse({ duration: INSTALL_TIMEOUT, orElse: () => Effect.succeed(null) }),
            Effect.map(outcome => ({ outcome, spawnError: null })),
            Effect.catch(error => Effect.succeed({ outcome: null, spawnError: error instanceof Error ? error.message : String(error) })),
          )
          const step = (status: StepStatus, detail: string | null, restartReason: string | null = null): StepResult => ({
            plugin,
            step: 'install',
            status,
            restartReason,
            detail: detail === null ? null : redact(detail, resolved),
          })
          if (result.outcome === null)
            return result.spawnError === null
              ? step('failed', 'dshx add ran longer than 5 minutes and was stopped; the profile may hold part of the change.')
              : step('failed', `dshx add could not start: ${result.spawnError}`)
          const envelope = yield* Effect.option(decodeEnvelope(result.outcome.stdout))
          yield* Effect.annotateCurrentSpan({ 'process.exit.code': result.outcome.exitCode })
          if (envelope._tag === 'None') return step('failed', `dshx add printed no result (exit ${String(result.outcome.exitCode)}).`)
          const value = envelope.value
          if (!value.ok) return step('failed', `${value.error.message} ${value.error.hint}`)
          return value.data.files.length === 0
            ? step('applied', 'already in the profile')
            : step(
                'restart-required',
                value.data.warnings.length === 0 ? null : value.data.warnings.join(' '),
                value.data.restart ?? 'DSH reads the profile at boot',
              )
        })

        const switchRows = (plugin: string, entryIds: readonly string[], action: PackAction) =>
          Effect.gen(function* () {
            const manager = input.manager()
            const current = yield* rows
            const each = (entryId: string): Effect.Effect<StepResult> => {
              const step = (status: StepStatus, detail: string | null, restartReason: string | null = null): StepResult => ({
                plugin,
                step: action,
                status,
                restartReason,
                detail: detail?.slice(0, MAX_DETAIL) ?? null,
              })
              const row = current?.find(candidate => candidate.entryId === entryId)
              if (manager === undefined || row === undefined) return Effect.succeed(step('failed', `entry ${entryId} is no longer listed`))
              return Effect.tryPromise(() => manager.setPluginEnabled(row.entryId, action === 'enable')).pipe(
                Effect.map(result =>
                  step(
                    result.application,
                    result.error === undefined ? null : [result.error.code, result.error.diagnostic].filter(part => part !== undefined).join(': '),
                    result.restartReason ?? null,
                  ),
                ),
                Effect.catch(error => Effect.succeed(step('failed', String(error instanceof Error ? error.message : error)))),
              )
            }
            const results = yield* Effect.forEach(entryIds, each)
            return results.reduce((worst, next) => (STATUS_RANK[next.status] > STATUS_RANK[worst.status] ? next : worst))
          })

        const apply = Effect.fn('onboarding pack apply')(function* (request: {
          readonly pack: string
          readonly action: PackAction
          readonly prerequisites: ReadonlyMap<string, 'done' | 'todo' | 'unknown' | 'off'>
          readonly plugins?: readonly string[] | undefined
        }) {
          yield* Effect.annotateCurrentSpan({ 'onboarding.pack': request.pack, 'onboarding.pack.action': request.action })
          return yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const { plan, toolchain: resolved } = yield* planWith(request)
              // One plugin at a time: concurrent dshx add runs would contend for the profile's package lock.
              const results = yield* Effect.forEach(
                plan.unavailable === null ? PackPlan.stepsOf(plan, request.plugins) : [],
                (plugin): Effect.Effect<StepResult> => {
                  const change = plan.change.find(step => step.plugin === plugin)
                  if (change !== undefined) return switchRows(plugin, change.entryIds, request.action)
                  return resolved.kind === 'automatic'
                    ? install(plugin, resolved)
                    : Effect.succeed({ plugin, step: 'install', status: 'manual', restartReason: null, detail: resolved.reason })
                },
              )
              yield* Effect.annotateCurrentSpan({ 'onboarding.pack.steps': results.length })
              return { preview: plan, results, summary: PackPlan.summarize({ preview: plan, results }) } satisfies PackOutcome
            }),
          )
        })

        return PackControls.of({ entries, preview, apply })
      }),
    )
}
