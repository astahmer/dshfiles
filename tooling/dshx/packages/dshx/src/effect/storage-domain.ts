import type { DomainChanged, DomainSpec, KvTable, TableKeyOf, TableValueOf } from '@deepseek-ai/dsh-storage-domain'
import { Context, Effect, Layer, Option, Queue, Schema, Scope, Semaphore, Stream } from 'effect'
import { HostContext, hostService } from './host-context.js'

const domainErrorCode = Schema.Literals(['already-open', 'facet-unsupported', 'invalid-record', 'missing-key', 'closed'])

const DomainErrorCause = Schema.Struct({ code: domainErrorCode })

const codeOf = (cause: unknown) => Option.getOrUndefined(Schema.decodeUnknownOption(DomainErrorCause)(cause))?.code

/** Write locks the current fiber holds, so a write inside `withWriteLock` does not wait on its own permit. */
const HeldWriteLocks = Context.Reference<ReadonlySet<Semaphore.Semaphore>>('@dshfiles/dshx/StorageDomain/HeldWriteLocks', {
  defaultValue: () => new Set(),
})

const withLock =
  (lock: Semaphore.Semaphore) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(HeldWriteLocks, held => (held.has(lock) ? effect : lock.withPermit(Effect.provideService(effect, HeldWriteLocks, new Set([...held, lock])))))

/** The Host storage facility could not open a domain (wrong spec, a second open of the same name, a backend failure). */
export class StorageDomainOpenFailed extends Schema.TaggedError<StorageDomainOpenFailed>()('StorageDomainOpenFailed', {
  domain: Schema.String,
  code: Schema.optional(domainErrorCode),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Storage domain "${this.domain}" could not be opened${this.code === undefined ? '' : ` (${this.code})`}.`
  }
}

/** A read of an open domain failed, typically because the storage row unloaded and closed it. */
export class StorageDomainReadFailed extends Schema.TaggedError<StorageDomainReadFailed>()('StorageDomainReadFailed', {
  domain: Schema.String,
  table: Schema.String,
  code: Schema.optional(domainErrorCode),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Reading table "${this.table}" of storage domain "${this.domain}" failed${this.code === undefined ? '' : ` (${this.code})`}.`
  }
}

/** A durable write was rejected: an invalid record, a closed domain, or a backend failure. */
export class StorageDomainWriteFailed extends Schema.TaggedError<StorageDomainWriteFailed>()('StorageDomainWriteFailed', {
  domain: Schema.String,
  table: Schema.String,
  operation: Schema.Literals(['put', 'delete', 'update']),
  code: Schema.optional(domainErrorCode),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Writing (${this.operation}) table "${this.table}" of storage domain "${this.domain}" failed${this.code === undefined ? '' : ` (${this.code})`}.`
  }
}

/** One table of an open domain; reads are synchronous snapshots, writes resolve once durable. */
export interface StorageTable<Key extends string, Value> {
  readonly get: (key: Key) => Effect.Effect<Option.Option<Value>, StorageDomainReadFailed>
  readonly entries: Effect.Effect<ReadonlyArray<readonly [Key, Value]>, StorageDomainReadFailed>
  readonly size: Effect.Effect<number, StorageDomainReadFailed>
  readonly put: (key: Key, value: Value) => Effect.Effect<void, StorageDomainWriteFailed>
  readonly delete: (key: Key) => Effect.Effect<boolean, StorageDomainWriteFailed>
  /** Replace an existing record with `f(current)`; fails with `missing-key` when the record is absent. */
  readonly update: (key: Key, f: (current: Value) => Value) => Effect.Effect<Value, StorageDomainWriteFailed>
}

/** A domain open for the lifetime of the Scope that opened it. */
export interface OpenStorageDomain<Spec extends DomainSpec> {
  readonly name: string
  readonly table: <Name extends keyof Spec['tables'] & string>(name: Name) => StorageTable<TableKeyOf<Spec, Name>, TableValueOf<Spec, Name>>
  /** Run a read-modify-write sequence with no other write of this domain in between; writes inside it reuse the lock. */
  readonly withWriteLock: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Durable changes of this domain from any writer on the Host, as they are committed. */
  readonly changes: Stream.Stream<DomainChanged>
}

export class StorageDomain extends Context.Service<
  StorageDomain,
  {
    /** Open a domain for the current Scope; closing the Scope drains queued writes and closes it. */
    readonly open: <Spec extends DomainSpec>(spec: Spec) => Effect.Effect<OpenStorageDomain<Spec>, StorageDomainOpenFailed, Scope.Scope>
  }
>()('@dshfiles/dshx/StorageDomain') {
  static readonly layer = Layer.effect(
    StorageDomain,
    Effect.gen(function* () {
      const host = yield* HostContext
      const facility = yield* hostService('storageDomain')

      const tableOf = <Key extends string, Value>(domain: string, name: string, native: KvTable<Key, Value>, writeLock: Semaphore.Semaphore) => {
        const read = <A>(evaluate: () => A) =>
          Effect.try({ try: evaluate, catch: cause => new StorageDomainReadFailed({ domain, table: name, code: codeOf(cause), cause }) })
        const write = <A>(operation: StorageDomainWriteFailed['operation'], run: () => Promise<A>) =>
          withLock(writeLock)(
            Effect.tryPromise({
              try: run,
              catch: cause => new StorageDomainWriteFailed({ domain, table: name, operation, code: codeOf(cause), cause }),
            }),
          )
        const table: StorageTable<Key, Value> = {
          get: key => read(() => Option.fromUndefinedOr(native.get(key))),
          entries: read(() => [...native.entries()]),
          size: read(() => native.size),
          put: (key, value) => write('put', () => native.put(key, value)),
          delete: key => write('delete', () => native.delete(key)),
          update: (key, f) => write('update', () => native.update(key, f)),
        }
        return table
      }

      const open = Effect.fn('storage-domain open')(function* <Spec extends DomainSpec>(spec: Spec) {
        yield* Effect.annotateCurrentSpan({ 'dshx.storage.domain': spec.name })
        const domain = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => facility.open(spec),
            catch: cause => new StorageDomainOpenFailed({ domain: spec.name, code: codeOf(cause), cause }),
          }),
          opened => Effect.tryPromise(() => opened.close()).pipe(Effect.ignore({ log: 'Warn', message: `storage domain ${spec.name} did not close cleanly` })),
        )
        const writeLock = yield* Semaphore.make(1)
        const changes = Stream.callback<DomainChanged>(queue =>
          Effect.acquireRelease(
            Effect.sync(() =>
              host.ctx.on('domain/changed', change => {
                if (change.domain === spec.name) Queue.offerUnsafe(queue, change)
              }),
            ),
            dispose => Effect.sync(dispose),
          ),
        )
        const opened: OpenStorageDomain<Spec> = {
          name: domain.name,
          table: name => tableOf(spec.name, name, domain.table(name), writeLock),
          withWriteLock: withLock(writeLock),
          changes,
        }
        return opened
      })

      return StorageDomain.of({ open })
    }),
  )
}
