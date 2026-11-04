import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Duration, Effect, Layer, Option, Schema, Semaphore, Stream } from 'effect'
import {
  resourceSnapshotSchema,
  type ResourcePool as ResourcePoolValue,
  type ResourcePoolEntry,
  type ResourceProbe,
  type RuntimeStatus as RuntimeStatusValue,
  type SessionSummary,
} from './api.js'
import { failureCodeOf, type TaggedFailure } from './errors.js'
import { HostDirectory } from './host-directory.js'
import type { RuntimeRecord } from './records.js'
import { ResourceSnapshotModel } from './resource-snapshot.js'
import { RuntimePool } from './runtime-pool.js'
import { StatusSnapshotsModel } from './status-snapshots.js'

const passthrough = <S extends Schema.Struct.Fields>(fields: S) => Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)])

const titleSchema = Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))))
const sessionRowSchema = passthrough({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  cwd: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  running: Schema.Boolean,
  blank: Schema.Boolean,
  updatedAt: Schema.Number.check(Schema.isFinite()),
  title: titleSchema,
  // The remote list names a thread through its title projection; an untitled thread reports null there.
  projections: Schema.optional(passthrough({ values: Schema.optional(passthrough({ title: titleSchema })) })),
})
const decodeSessionList = Schema.decodeUnknownEffect(passthrough({ items: Schema.Array(sessionRowSchema).check(Schema.isMaxLength(10_000)) }))

const workspaceRowSchema = passthrough({
  workspaceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
  sessionIds: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(10_000))),
})
type WorkspaceRow = Schema.Schema.Type<typeof workspaceRowSchema>
const decodeWorkspaceRow = Schema.decodeUnknownOption(workspaceRowSchema)
const decodeWorkspaceContainer = Schema.decodeUnknownOption(
  passthrough({
    items: Schema.optional(Schema.Unknown),
    value: Schema.optional(Schema.Unknown),
    workspace: Schema.optional(Schema.Unknown),
    workspaces: Schema.optional(Schema.Unknown),
    baseline: Schema.optional(Schema.Unknown),
    snapshot: Schema.optional(Schema.Unknown),
  }),
)
const decodeResourceSnapshot = Schema.decodeUnknownOption(resourceSnapshotSchema)

/** Every workspace row anywhere in the follow frames, bounded in depth and count. */
const collectWorkspaces = (frames: readonly unknown[]): WorkspaceRow[] => {
  const results = new Map<string, WorkspaceRow>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 16 || results.size >= 256) return
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 512)) visit(item, depth + 1)
      return
    }
    const workspace = decodeWorkspaceRow(value)
    if (Option.isSome(workspace)) results.set(workspace.value.workspaceId, workspace.value)
    const container = decodeWorkspaceContainer(value)
    if (Option.isNone(container)) return
    for (const key of ['items', 'value', 'workspace', 'workspaces', 'baseline', 'snapshot'] as const) {
      const child = container.value[key]
      if (child !== undefined) visit(child, depth + 1)
    }
  }
  for (const frame of frames) visit(frame, 0)
  return [...results.values()]
}

const failureText = (error: TaggedFailure & { readonly message: string }) => ({ code: failureCodeOf(error), message: error.message })

/** What a runtime row says about its record and its pooled connection. */
const runtimeSummary = Effect.fnUntraced(function* (record: RuntimeRecord) {
  const pool = yield* RuntimePool
  const generation = yield* pool.generation(record.id)
  const lastError = yield* pool.lastError(record.id)
  return {
    id: record.id,
    hostId: record.hostId,
    name: record.name,
    identity: record.identity,
    ...(record.locator.kind === 'ssh' && { remoteHome: record.locator.remoteHome }),
    ...(record.lastSeenAt !== undefined && { lastSeenAt: record.lastSeenAt }),
    connected: generation !== undefined,
    ...(lastError !== undefined && { lastError }),
  }
})

export class RuntimeSummaries {
  static readonly of = runtimeSummary
}

/** Each runtime's workspaces and sessions, served from a snapshot that refreshes in the background. */
export class RuntimeStatus extends Context.Service<
  RuntimeStatus,
  {
    readonly status: (runtimeId: string) => Effect.Effect<RuntimeStatusValue>
    readonly invalidate: (runtimeId: string) => Effect.Effect<void>
  }
>()('@dshfiles/multi-host/RuntimeStatus') {
  static readonly layer = Layer.effect(
    RuntimeStatus,
    Effect.gen(function* () {
      const pool = yield* RuntimePool
      const directory = yield* HostDirectory

      const load = (runtime: RuntimeRecord): Effect.Effect<RuntimeStatusValue> =>
        pool
          .use(
            runtime.id,
            gateway =>
              Effect.all(
                [
                  gateway.follow({ endpoint: 'workspace/follow', args: {}, timeout: Duration.seconds(10) }),
                  Effect.flatMap(gateway.run({ namespace: 'session', method: 'list', args: { _request: {} } }), value =>
                    decodeSessionList(value).pipe(Effect.orDie),
                  ),
                ],
                { concurrency: 'unbounded' },
              ),
            { mutation: false },
          )
          .pipe(
            Effect.flatMap(([frames, list]) =>
              Effect.gen(function* () {
                const sessions = list.items.slice(0, 500).map(item => {
                  const title = item.title ?? item.projections?.values?.title ?? undefined
                  return {
                    runtimeId: runtime.id,
                    sessionId: item.sessionId,
                    running: item.running,
                    blank: item.blank,
                    updatedAt: item.updatedAt,
                    ...(item.cwd !== undefined && { cwd: item.cwd }),
                    ...(title !== undefined && title !== '' && { title }),
                  } satisfies SessionSummary
                })
                const workspaces = collectWorkspaces(frames).map(item => ({
                  runtimeId: runtime.id,
                  workspaceId: item.workspaceId,
                  path: item.path,
                  title: item.title ?? item.path,
                  sessionIds: item.sessionIds ?? [],
                }))
                const refreshed = (yield* directory.findRuntime(runtime.id).pipe(Effect.orElseSucceed(() => undefined))) ?? runtime
                return { ok: true as const, runtime: yield* runtimeSummary(refreshed), workspaces, sessions }
              }),
            ),
            Effect.catch(error =>
              Effect.succeed({
                ok: false as const,
                hostId: runtime.hostId,
                runtimeId: runtime.id,
                ...failureText(error),
                stale: true as const,
                ...(runtime.lastSeenAt !== undefined && { lastSeenAt: runtime.lastSeenAt }),
              }),
            ),
            Effect.provideService(RuntimePool, pool),
          )

      const snapshots = yield* StatusSnapshotsModel.make<RuntimeStatusValue>({
        successTtl: Duration.seconds(30),
        failureTtl: Duration.seconds(45),
        capacity: 128,
        spanName: 'multi-host runtime status refresh',
      })

      // A fresh connection makes a cached failure stale.
      yield* DshxPlugin.worker(
        Stream.runForEach(pool.connected, runtimeId =>
          Effect.flatMap(snapshots.read(runtimeId), cached =>
            cached.status?.ok === false && !cached.refreshing ? snapshots.invalidate(runtimeId) : Effect.void,
          ),
        ),
      )

      const status = Effect.fn('multi-host runtime status')(function* (runtimeId: string) {
        const runtime = yield* directory.findRuntime(runtimeId).pipe(Effect.orElseSucceed(() => undefined))
        if (runtime === undefined)
          return {
            ok: false,
            hostId: 'unknown',
            runtimeId,
            code: 'runtime-not-found',
            message: 'No recorded runtime has this id.',
            stale: true,
          } satisfies RuntimeStatusValue
        const cached = yield* snapshots.read(runtime.id)
        if (cached.status !== undefined && !cached.stale) return cached.status
        yield* snapshots.refresh(runtime.id, load(runtime))
        if (cached.status !== undefined) return { ...cached.status, stale: true, refreshing: true } satisfies RuntimeStatusValue
        return {
          ok: false,
          hostId: runtime.hostId,
          runtimeId: runtime.id,
          code: 'runtime-status-refreshing',
          message: 'A remote status refresh is running.',
          stale: true,
          refreshing: true,
          ...(runtime.lastSeenAt !== undefined && { lastSeenAt: runtime.lastSeenAt }),
        } satisfies RuntimeStatusValue
      })

      return RuntimeStatus.of({ status, invalidate: snapshots.invalidate })
    }),
  )
}

const resourceFailure = (code: string): ResourceProbe => ({
  ok: false,
  code: code.slice(0, 128),
  message: 'Resource data is unavailable. Reconnect the runtime or update its multi-host plugin.',
})

/** The resource load of every remote host, probed in the background at most four at a time. */
export class ResourcePool extends Context.Service<
  ResourcePool,
  {
    readonly read: Effect.Effect<ResourcePoolValue, Effect.Error<HostDirectory['Service']['listHosts']>>
    readonly invalidate: (runtimeId: string) => Effect.Effect<void>
  }
>()('@dshfiles/multi-host/ResourcePool') {
  static readonly layer = Layer.effect(
    ResourcePool,
    Effect.gen(function* () {
      const pool = yield* RuntimePool
      const directory = yield* HostDirectory
      const probes = yield* Semaphore.make(4)
      const snapshots = yield* StatusSnapshotsModel.make<ResourceProbe>({
        successTtl: Duration.seconds(30),
        failureTtl: Duration.seconds(45),
        capacity: 128,
        spanName: 'multi-host resource snapshot refresh',
      })

      const probe = (runtimeId: string): Effect.Effect<ResourceProbe> =>
        pool
          .use(runtimeId, gateway => gateway.api('resourceSnapshot').pipe(Effect.timeout(Duration.seconds(5))), { mutation: false })
          .pipe(
            Effect.map((raw): ResourceProbe =>
              Option.match(decodeResourceSnapshot(raw), {
                onNone: () => ({ ok: false, code: 'resource-invalid', message: 'The remote host returned unsupported resource data.' }),
                onSome: snapshot => ({ ok: true, snapshot }),
              }),
            ),
            Effect.catch(error => Effect.succeed(resourceFailure(failureCodeOf(error)))),
            probes.withPermits(1),
          )

      const entryOf = Effect.fnUntraced(function* (input: {
        readonly host: Effect.Success<HostDirectory['Service']['listHosts']>[number]
        readonly runtimes: readonly RuntimeRecord[]
      }) {
        const runtime = input.runtimes
          .filter(item => item.hostId === input.host.id && item.locator.kind === 'ssh')
          .sort((left, right) => (right.lastSeenAt ?? right.createdAt).localeCompare(left.lastSeenAt ?? left.createdAt) || left.id.localeCompare(right.id))[0]
        if (runtime === undefined) {
          return {
            hostId: input.host.id,
            hostName: input.host.name,
            runtimeId: null,
            destination: null,
            hidden: input.host.hidden,
            probe: { ok: false, code: 'runtime-unavailable', message: 'No remote DSH runtime is registered.' },
            stale: false,
            refreshing: false,
          } satisfies ResourcePoolEntry
        }
        const cached = yield* snapshots.read(runtime.id)
        if (cached.stale) yield* snapshots.refresh(runtime.id, probe(runtime.id))
        const current = yield* snapshots.read(runtime.id)
        return {
          hostId: input.host.id,
          hostName: input.host.name,
          runtimeId: runtime.id,
          destination: { kind: 'runtime', runtimeId: runtime.id },
          hidden: input.host.hidden,
          probe: current.status ?? { ok: false, code: 'resource-refreshing', message: 'Waiting for a fresh resource snapshot.' },
          stale: current.stale,
          refreshing: current.refreshing,
        } satisfies ResourcePoolEntry
      })

      const read = Effect.fn('multi-host resource pool read')(function* () {
        const current = yield* directory.read
        const hosts = yield* Effect.forEach(
          current.hosts.filter(host => host.connector.kind === 'ssh'),
          host => entryOf({ host, runtimes: current.runtimes }),
        )
        return { hosts, selected: ResourceSnapshotModel.selectAutoHost(hosts) } satisfies ResourcePoolValue
      })

      return ResourcePool.of({ read: read(), invalidate: snapshots.invalidate })
    }),
  )
}
