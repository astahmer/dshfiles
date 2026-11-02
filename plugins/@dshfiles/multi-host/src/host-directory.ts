import { randomUUID } from 'node:crypto'
import { Context, Effect, FileSystem, Layer, Path, Result, Schema, Semaphore } from 'effect'
import {
  ConnectorKindMismatch,
  DirectoryCorrupt,
  DirectoryPathInvalid,
  DirectoryRecordInvalid,
  DirectoryUnreadable,
  DirectoryVersionUnsupported,
  DirectoryWriteFailed,
  HostConnectorInUse,
  HostHasRuntimes,
  HostNotFound,
  HostOrderIncomplete,
  type DirectoryReadError,
  type DirectoryWriteError,
} from './errors.js'
import { MultiHostPaths } from './paths.js'
import { PrivateFile } from './private-file.js'
import {
  hostDirectorySchema,
  hostRecordSchema,
  runtimeOriginPort,
  runtimeRecordSchema,
  type HostDirectory as HostDirectoryValue,
  type HostRecord,
  type RuntimeRecord,
} from './records.js'

const emptyDirectory = (): HostDirectoryValue => ({ schemaVersion: 2, hosts: [], runtimes: [], retiredPorts: [] })

const completeRuntimePorts = (directory: HostDirectoryValue): HostDirectoryValue => {
  const occupied = new Set(directory.retiredPorts)
  const runtimes = [...directory.runtimes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(runtime => {
      const originPort = runtime.originPort ?? runtimeOriginPort(runtime.id, [...occupied])
      occupied.add(originPort)
      return { ...runtime, originPort }
    })
  return { ...directory, runtimes }
}

const byPosition = (left: HostRecord, right: HostRecord): number => (left.position ?? 0) - (right.position ?? 0) || left.id.localeCompare(right.id)

const completeHostOrder = (directory: HostDirectoryValue): HostDirectoryValue => {
  const positions = new Set(directory.hosts.flatMap(host => (host.position === undefined ? [] : [host.position])))
  let nextPosition = 0
  const hosts = directory.hosts.map(host => {
    if (host.position !== undefined) return host
    while (positions.has(nextPosition)) nextPosition += 1
    positions.add(nextPosition)
    return { ...host, position: nextPosition }
  })
  return { ...directory, hosts: hosts.sort(byPosition) }
}

const legacyDirectorySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  hosts: Schema.Array(
    Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1)),
      name: Schema.String.check(Schema.isMinLength(1)),
      connector: Schema.Union([
        Schema.Struct({ kind: Schema.Literal('local'), launchUrl: Schema.String.check(Schema.isMinLength(1)) }),
        Schema.Struct({
          kind: Schema.Literal('ssh'),
          sshTarget: Schema.String.check(Schema.isMinLength(1)),
          remoteHome: Schema.String.check(Schema.isMinLength(1)),
          unit: Schema.String.check(Schema.isMinLength(1)),
        }),
      ]),
      expected: Schema.Struct({ homeLeaf: Schema.String.check(Schema.isMinLength(1)), profile: Schema.String.check(Schema.isMinLength(1)) }),
      createdAt: Schema.String.check(Schema.isMinLength(10)),
    }),
  ),
})

const strict = { onExcessProperty: 'error' } as const
const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))
const decodeDirectory = Schema.decodeUnknownResult(hostDirectorySchema, strict)
const decodeLegacy = Schema.decodeUnknownResult(legacyDirectorySchema)
const decodeHost = Schema.decodeUnknownEffect(hostRecordSchema, strict)
const decodeRuntime = Schema.decodeUnknownEffect(runtimeRecordSchema, strict)
const decodeNext = Schema.decodeUnknownEffect(hostDirectorySchema, strict)

const migrateLegacy = (legacy: Schema.Schema.Type<typeof legacyDirectorySchema>) =>
  Effect.forEach(legacy.hosts, oldHost =>
    Effect.all([
      decodeHost({
        schemaVersion: 2,
        id: oldHost.id,
        name: oldHost.name,
        connector: oldHost.connector.kind === 'local' ? { kind: 'local' } : { kind: 'ssh', sshTarget: oldHost.connector.sshTarget },
        createdAt: oldHost.createdAt,
      }),
      decodeRuntime({
        schemaVersion: 2,
        id: randomUUID(),
        hostId: oldHost.id,
        name: oldHost.name,
        locator:
          oldHost.connector.kind === 'local'
            ? { kind: 'local', launchUrl: oldHost.connector.launchUrl }
            : { kind: 'ssh', remoteHome: oldHost.connector.remoteHome, unit: oldHost.connector.unit },
        identity: null,
        createdAt: oldHost.createdAt,
      }),
    ]),
  ).pipe(
    Effect.flatMap(records => decodeNext({ schemaVersion: 2, hosts: records.map(([host]) => host), runtimes: records.map(([, runtime]) => runtime) })),
    Effect.mapError(() => new DirectoryVersionUnsupported()),
  )

const nextHostPosition = (hosts: readonly HostRecord[]): number => hosts.reduce((next, host) => Math.max(next, (host.position ?? -1) + 1), 0)

const occupiedPorts = (directory: HostDirectoryValue, exceptRuntimeId: string): number[] => [
  ...directory.retiredPorts,
  ...directory.runtimes.filter(runtime => runtime.id !== exceptRuntimeId).flatMap(runtime => (runtime.originPort === undefined ? [] : [runtime.originPort])),
]

/** Same directory value means nothing changed and nothing is written. */
interface Change<Result> {
  readonly next: HostDirectoryValue
  readonly result: Result
}

/** The private registry of hosts and their runtimes, one transaction at a time. */
export class HostDirectory extends Context.Service<
  HostDirectory,
  {
    readonly read: Effect.Effect<HostDirectoryValue, DirectoryReadError>
    readonly listHosts: Effect.Effect<readonly HostRecord[], DirectoryReadError>
    readonly listRuntimes: (hostId?: string) => Effect.Effect<readonly RuntimeRecord[], DirectoryReadError>
    readonly findHost: (id: string) => Effect.Effect<HostRecord | undefined, DirectoryReadError>
    readonly findRuntime: (id: string) => Effect.Effect<RuntimeRecord | undefined, DirectoryReadError>
    readonly upsertHost: (record: HostRecord) => Effect.Effect<HostRecord, DirectoryWriteError | HostConnectorInUse>
    readonly setHostHidden: (input: { readonly id: string; readonly hidden: boolean }) => Effect.Effect<HostRecord, DirectoryWriteError | HostNotFound>
    readonly reorderHosts: (ids: readonly string[]) => Effect.Effect<readonly HostRecord[], DirectoryWriteError | HostOrderIncomplete>
    readonly upsertRuntime: (record: RuntimeRecord) => Effect.Effect<RuntimeRecord, DirectoryWriteError | HostNotFound | ConnectorKindMismatch>
    readonly removeRuntime: (id: string) => Effect.Effect<boolean, DirectoryWriteError>
    readonly removeHost: (input: { readonly id: string; readonly removeDirectory: boolean }) => Effect.Effect<boolean, DirectoryWriteError | HostHasRuntimes>
  }
>()('@dshfiles/multi-host/HostDirectory') {
  static readonly layer = Layer.effect(
    HostDirectory,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const paths = yield* MultiHostPaths
      const directoryPath = paths.dataPath('directory.json')
      const legacyPath = paths.dataPath('hosts.json')
      const lock = yield* Semaphore.make(1)
      const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
        effect.pipe(Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, path))

      const readText = Effect.fnUntraced(function* (file: string) {
        const state = yield* provided(PrivateFile.secure(file)).pipe(Effect.mapError(cause => new DirectoryUnreadable({ cause })))
        if (state === 'invalid') return yield* new DirectoryPathInvalid()
        return yield* provided(PrivateFile.readIfPresent(file)).pipe(Effect.mapError(cause => new DirectoryUnreadable({ cause })))
      })

      const readFromDisk = Effect.gen(function* () {
        const raw = (yield* readText(directoryPath)) ?? (yield* readText(legacyPath))
        if (raw === undefined) return emptyDirectory()
        const parsed = decodeJson(raw)
        if (Result.isFailure(parsed)) return yield* new DirectoryCorrupt()
        const current = decodeDirectory(parsed.success)
        if (Result.isSuccess(current)) return completeHostOrder(completeRuntimePorts(current.success))
        const legacy = decodeLegacy(parsed.success)
        if (Result.isFailure(legacy)) return yield* new DirectoryVersionUnsupported()
        return completeHostOrder(completeRuntimePorts(yield* migrateLegacy(legacy.success)))
      })

      const writeToDisk = (next: HostDirectoryValue) =>
        provided(PrivateFile.write({ path: directoryPath, body: `${JSON.stringify(next, null, 2)}\n`, commit: 'rename' })).pipe(
          Effect.andThen(fileSystem.remove(legacyPath, { force: true })),
          Effect.mapError(cause => new DirectoryWriteFailed({ cause })),
        )

      const read = lock.withPermits(1)(readFromDisk).pipe(Effect.withSpan('multi-host directory read'))

      const transact = <Result, E>(update: (current: HostDirectoryValue) => Effect.Effect<Change<Result>, E>) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* readFromDisk
            const change = yield* update(current)
            if (change.next !== current) yield* writeToDisk(change.next)
            return change.result
          }),
        )

      /** A record the caller built is validated like the stored file, so a bad one never reaches disk. */
      const validNext = (value: HostDirectoryValue) =>
        decodeNext(value).pipe(Effect.mapError(error => new DirectoryRecordInvalid({ issue: error.message.slice(0, 2_000) })))

      const upsertHost = Effect.fn('multi-host directory upsert host')(function* (input: HostRecord) {
        const record = yield* decodeHost(input).pipe(Effect.mapError(error => new DirectoryRecordInvalid({ issue: error.message.slice(0, 2_000) })))
        return yield* transact(current =>
          Effect.gen(function* () {
            const previous = current.hosts.find(host => host.id === record.id)
            const stored: HostRecord = {
              ...record,
              hidden: record.hidden || previous?.hidden === true,
              position: record.position ?? previous?.position ?? nextHostPosition(current.hosts),
            }
            if (current.runtimes.some(runtime => runtime.hostId === record.id && runtime.locator.kind !== record.connector.kind)) {
              return yield* new HostConnectorInUse({ hostId: record.id })
            }
            const hosts = [...current.hosts.filter(host => host.id !== record.id), stored].sort(byPosition)
            const next = yield* validNext({ schemaVersion: 2, hosts, runtimes: current.runtimes, retiredPorts: current.retiredPorts })
            return { next, result: stored }
          }),
        )
      })

      const setHostHidden = Effect.fn('multi-host directory set host hidden')(function* (input: { readonly id: string; readonly hidden: boolean }) {
        return yield* transact(current =>
          Effect.gen(function* () {
            const previous = current.hosts.find(host => host.id === input.id)
            if (previous === undefined) return yield* new HostNotFound({ hostId: input.id })
            const record: HostRecord = { ...previous, hidden: input.hidden }
            if (previous.hidden === input.hidden) return { next: current, result: record }
            const next = yield* validNext({ ...current, hosts: current.hosts.map(host => (host.id === input.id ? record : host)) })
            return { next, result: record }
          }),
        )
      })

      const reorderHosts = Effect.fn('multi-host directory reorder hosts')(function* (ids: readonly string[]) {
        return yield* transact(current =>
          Effect.gen(function* () {
            const byId = new Map(current.hosts.map(host => [host.id, host]))
            if (new Set(ids).size !== ids.length || ids.length !== current.hosts.length || ids.some(id => !byId.has(id))) {
              return yield* new HostOrderIncomplete()
            }
            const hosts = ids.flatMap((id, position) => {
              const host = byId.get(id)
              return host === undefined ? [] : [{ ...host, position }]
            })
            const next = yield* validNext({ ...current, hosts })
            return { next, result: hosts }
          }),
        )
      })

      const upsertRuntime = Effect.fn('multi-host directory upsert runtime')(function* (input: RuntimeRecord) {
        const record = yield* decodeRuntime(input).pipe(Effect.mapError(error => new DirectoryRecordInvalid({ issue: error.message.slice(0, 2_000) })))
        return yield* transact(current =>
          Effect.gen(function* () {
            const host = current.hosts.find(candidate => candidate.id === record.hostId)
            if (host === undefined) return yield* new HostNotFound({ hostId: record.hostId })
            if (host.connector.kind !== record.locator.kind) return yield* new ConnectorKindMismatch()
            const previous = current.runtimes.find(runtime => runtime.id === record.id)
            const normalized: RuntimeRecord = {
              ...record,
              originPort: record.originPort ?? previous?.originPort ?? runtimeOriginPort(record.id, occupiedPorts(current, record.id)),
            }
            const runtimes = [...current.runtimes.filter(runtime => runtime.id !== record.id), normalized].sort((left, right) =>
              left.id.localeCompare(right.id),
            )
            const next = yield* validNext({ schemaVersion: 2, hosts: current.hosts, runtimes, retiredPorts: current.retiredPorts })
            return { next, result: normalized }
          }),
        )
      })

      const removeRuntime = Effect.fn('multi-host directory remove runtime')(function* (id: string) {
        return yield* transact(current => {
          const removed = current.runtimes.find(runtime => runtime.id === id)
          if (removed === undefined) return Effect.succeed({ next: current, result: false })
          const retiredPorts =
            removed.originPort === undefined || current.retiredPorts.includes(removed.originPort)
              ? current.retiredPorts
              : [...current.retiredPorts, removed.originPort]
          const next: HostDirectoryValue = {
            schemaVersion: 2,
            hosts: current.hosts,
            runtimes: current.runtimes.filter(runtime => runtime.id !== id),
            retiredPorts,
          }
          return Effect.succeed({ next, result: true })
        })
      })

      const removeHost = Effect.fn('multi-host directory remove host')(function* (input: { readonly id: string; readonly removeDirectory: boolean }) {
        return yield* transact(current =>
          Effect.gen(function* () {
            if (!current.hosts.some(host => host.id === input.id)) return { next: current, result: false }
            const runtimes = current.runtimes.filter(runtime => runtime.hostId === input.id)
            if (runtimes.length > 0 && !input.removeDirectory) return yield* new HostHasRuntimes({ hostId: input.id })
            const retiredPorts = input.removeDirectory
              ? [...new Set([...current.retiredPorts, ...runtimes.flatMap(runtime => (runtime.originPort === undefined ? [] : [runtime.originPort]))])]
              : current.retiredPorts
            const next: HostDirectoryValue = {
              schemaVersion: 2,
              hosts: current.hosts.filter(host => host.id !== input.id),
              runtimes: input.removeDirectory ? current.runtimes.filter(runtime => runtime.hostId !== input.id) : current.runtimes,
              retiredPorts,
            }
            return { next, result: true }
          }),
        )
      })

      return HostDirectory.of({
        read,
        listHosts: Effect.map(read, directory => directory.hosts),
        listRuntimes: hostId =>
          Effect.map(read, directory => (hostId === undefined ? directory.runtimes : directory.runtimes.filter(runtime => runtime.hostId === hostId))),
        findHost: id => Effect.map(read, directory => directory.hosts.find(host => host.id === id)),
        findRuntime: id => Effect.map(read, directory => directory.runtimes.find(runtime => runtime.id === id)),
        upsertHost,
        setHostHidden,
        reorderHosts,
        upsertRuntime,
        removeRuntime,
        removeHost,
      })
    }),
  )
}
