import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Ref, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { WorkspaceSyncView } from './api.js'
import { ActivityLog } from './host-edges-promise.js'
import { JjSettings } from './jj-settings.js'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'
import { workspaceSyncActivity } from './workspace-sync-outcome.js'

const MAX_OUTPUT_BYTES = 512 * 1024
const MAX_STDERR_BYTES = 64 * 1024
/** Installs and plugin rebuilds after a large rebase take minutes. */
const SYNC_TIMEOUT = Duration.minutes(30)
const KILL_GRACE = Duration.seconds(5)

const checkoutSyncOutputSchema = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(['up-to-date', 'synced', 'would-sync', 'refused', 'conflicted', 'build-failed']),
      rebuilt: Schema.Struct({ plugins: Schema.Array(Schema.String) }),
      plugins: Schema.Array(Schema.Struct({ name: Schema.String, host: Schema.Boolean, client: Schema.Boolean })),
      restart: Schema.Struct({ needed: Schema.Boolean }),
      conflicts: Schema.Array(Schema.String),
      hint: Schema.NullOr(Schema.String),
    }),
  ),
  error: Schema.optional(Schema.Struct({ message: Schema.String, hint: Schema.String })),
})
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeSyncOutput = Schema.decodeUnknownOption(checkoutSyncOutputSchema)

export interface WorkspaceSyncRequest {
  readonly repoRoot: string
  readonly bookmark: string
  readonly revision?: string | undefined
  readonly sessionId?: string | null | undefined
  readonly correlationId?: string | undefined
}

interface WorkspaceSyncInput extends WorkspaceSyncRequest {
  readonly workspace: string
}

const syncView = (input: WorkspaceSyncInput, state: WorkspaceSyncView['state'], message: string | null, finishedAt: number): WorkspaceSyncView => ({
  workspace: input.workspace,
  bookmark: input.bookmark,
  state,
  status: null,
  pluginsRebuilt: [],
  hotPlugins: [],
  restartNeeded: false,
  conflicts: [],
  message,
  finishedAt: state === 'running' ? null : new Date(finishedAt).toISOString(),
})

const collectText = (stream: Stream.Stream<Uint8Array, unknown>, maxBytes: number) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => '',
      (text, chunk) => (text.length >= maxBytes ? text : `${text}${chunk}`.slice(0, maxBytes)),
    ),
    Effect.orElseSucceed(() => ''),
  )

/**
 * Brings the checkout DSH runs from onto the landed revision with `dshx checkout sync`, one sync at a time. Lands that
 * arrive while one runs coalesce per repository, so the next sync takes only the newest revision.
 */
export class WorkspaceSync extends Context.Service<
  WorkspaceSync,
  {
    readonly enqueue: (request: WorkspaceSyncRequest) => Effect.Effect<void>
    readonly current: Effect.Effect<WorkspaceSyncView | null>
  }
>()('@dshfiles/jj-integration/WorkspaceSync') {
  static readonly layer = Layer.effect(
    WorkspaceSync,
    Effect.gen(function* () {
      const settings = yield* JjSettings
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const activity = yield* ActivityLog
      const pending = yield* Ref.make<ReadonlyMap<string, WorkspaceSyncInput>>(new Map())
      const view = yield* Ref.make<WorkspaceSyncView | null>(null)
      const wakes = yield* Queue.sliding<void>(1)

      const run = Effect.fn('jj-integration workspace sync')(function* (input: WorkspaceSyncInput) {
        yield* Effect.annotateCurrentSpan({ 'dshx.checkout.workspace': input.workspace, 'dshx.checkout.bookmark': input.bookmark })
        const now = yield* Clock.currentTimeMillis
        const failed = (message: string) => syncView(input, 'failed', message, now)
        const argv = yield* Effect.try(() => ThreadWorkspaceModel.checkoutSyncArgv(input)).pipe(Effect.option)
        if (Option.isNone(argv))
          return failed('dshx is not installed beside jj-integration; run `pnpm --dir plugins install --frozen-lockfile` in the repository.')
        const [executable = '', ...args] = argv.value
        const output = yield* spawner.spawn(ChildProcess.make(executable, args, { cwd: input.repoRoot, stdin: 'ignore', forceKillAfter: KILL_GRACE })).pipe(
          Effect.flatMap(handle =>
            Effect.all([collectText(handle.stdout, MAX_OUTPUT_BYTES), collectText(handle.stderr, MAX_STDERR_BYTES), Effect.ignore(handle.exitCode)], {
              concurrency: 'unbounded',
            }),
          ),
          Effect.scoped,
          Effect.timeoutOption(SYNC_TIMEOUT),
          Effect.orElseSucceed(() => Option.none<readonly [string, string, void]>()),
        )
        const finishedAt = yield* Clock.currentTimeMillis
        const done = (message: string) => syncView(input, 'failed', message, finishedAt)
        if (Option.isNone(output)) return done('dshx checkout sync did not finish in time.')
        const [stdout, stderr] = output.value
        const json = decodeJson(stdout)
        if (Option.isNone(json)) return done(`dshx checkout sync printed no result: ${stderr.trim().slice(-400)}`)
        const decoded = decodeSyncOutput(json.value)
        if (Option.isNone(decoded)) return done('dshx checkout sync printed a result this plugin cannot read; rebuild dshx.')
        const data = decoded.value.data
        if (data === undefined)
          return done(decoded.value.error === undefined ? 'dshx checkout sync failed.' : `${decoded.value.error.message} ${decoded.value.error.hint}`)
        const result: WorkspaceSyncView = {
          ...syncView(input, decoded.value.ok ? 'done' : 'failed', data.hint, finishedAt),
          status: data.status,
          pluginsRebuilt: [...data.rebuilt.plugins],
          hotPlugins: data.plugins.filter(plugin => plugin.client && !plugin.host).map(plugin => plugin.name),
          restartNeeded: data.restart.needed,
          conflicts: [...data.conflicts],
        }
        yield* Effect.annotateCurrentSpan({
          'dshx.checkout.state': result.state,
          'dshx.checkout.rebuilt_plugins': result.pluginsRebuilt.length,
          'dshx.checkout.restart_needed': result.restartNeeded,
        })
        return result
      })

      const takeNext = Ref.modify(pending, (current): readonly [WorkspaceSyncInput | undefined, ReadonlyMap<string, WorkspaceSyncInput>] => {
        const [first] = current.values()
        if (first === undefined) return [undefined, current]
        const rest = new Map(current)
        rest.delete(first.repoRoot)
        return [first, rest]
      })

      const drain: Effect.Effect<void> = Effect.gen(function* () {
        const next = yield* takeNext
        if (next === undefined) return
        yield* Ref.set(view, syncView(next, 'running', null, 0))
        const result = yield* run(next)
        yield* Ref.set(view, result)
        yield* activity.emit({ ...workspaceSyncActivity(result), path: next.repoRoot, sessionId: next.sessionId, correlationId: next.correlationId })
        yield* drain
      })

      yield* DshxPlugin.worker(Effect.forever(Effect.andThen(Queue.take(wakes), drain)))

      return WorkspaceSync.of({
        enqueue: Effect.fn('workspace sync enqueue')(function* (request: WorkspaceSyncRequest) {
          const workspace = (yield* settings.get).syncWorkspaceAfterLand.trim()
          if (workspace === '') return
          const input: WorkspaceSyncInput = { ...request, workspace }
          yield* Ref.update(pending, current => new Map([...current, [input.repoRoot, input]]))
          yield* Ref.set(view, syncView(input, 'running', null, 0))
          yield* Queue.offer(wakes, undefined)
        }),
        current: Ref.get(view),
      })
    }),
  )
}
