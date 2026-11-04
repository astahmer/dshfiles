import type { DomainChanged, DomainSpec, KvTable, TableKeyOf, TableValueOf } from '@deepseek-ai/dsh-storage-domain'
import { Context, Effect, Layer, Option, Queue, Schedule, Schema, Scope, Semaphore, Stream } from 'effect'
import { HostContext, hostService } from './host-context.js'

const domainErrorCode = Schema.Literals(['already-open', 'facet-unsupported', 'invalid-record', 'missing-key', 'closed'])

const DomainErrorCause = Schema.Struct({ code: domainErrorCode })

const codeOf = (cause: unknown) => Option.getOrUndefined(Schema.decodeUnknownOption(DomainErrorCause)(cause))?.code

/**
 * How long an open waits for a previous holder of the same domain to finish closing, when it cannot share that
 * holder's handle (a different package, or a changed table set). A domain that is really held twice still fails, after
 * this budget (about 5 s).
 */
const ALREADY_OPEN_RETRY = { schedule: Schedule.spaced('50 millis'), times: 100 } as const

/** Retry `open` while the facility reports the domain is still open elsewhere, then surface the last failure. */
export const openWaitingForClose = <A, R>(open: Effect.Effect<A, StorageDomainOpenFailed, R>): Effect.Effect<A, StorageDomainOpenFailed, R> =>
  Effect.retry(open, { ...ALREADY_OPEN_RETRY, while: (error: StorageDomainOpenFailed) => error.code === 'already-open' })

/** One native domain handle, shared by the instances of one package that hold it. */
interface SharedHandle<Handle> {
  readonly handle: Handle
  readonly fingerprint: string
  /** The activations holding it, each once: a second open within one activation still fails loud. */
  readonly holders: Set<unknown>
}

/**
 * Open domain handles by package and domain name, shared across bundle copies. A Host bundle reload starts the
 * rebuilt instance of a plugin while the old one still holds its domains (the old Scope closes only after the new
 * activation), and the facility refuses a second open of a name with `already-open` until the first is closed, which
 * made thread-sidebar's reload fatal. The new instance of the same package therefore reuses the open handle and the
 * last release closes it. The registry lives on `globalThis` because each bundle carries its own copy of this module.
 */
const SHARED_HANDLES = Symbol.for('@dshfiles/dshx/StorageDomain/shared-handles')
const sharedHandles = (): Map<string, SharedHandle<unknown>> => {
  const holder = globalThis as { [SHARED_HANDLES]?: Map<string, SharedHandle<unknown>> }
  holder[SHARED_HANDLES] ??= new Map()
  return holder[SHARED_HANDLES]
}

/** Shareable only while the table set and version match: a changed spec must open with its own schemas. */
const fingerprintOf = (spec: DomainSpec): string =>
  JSON.stringify([Object.keys(spec.tables).sort(), (spec as { readonly version?: unknown }).version ?? null, spec.global === undefined])

/**
 * Acquire a shared handle for `key`: reuse a live one with the same fingerprint, else open a new one. `isLive` lets the
 * caller drop a handle its facility no longer knows (the facility itself was reloaded and closed it).
 */
export const acquireSharedHandle = <Handle, R>(input: {
  readonly key: string
  /** The activation opening it (its Cordis context): only another activation of the package may share the handle. */
  readonly holder: unknown
  readonly fingerprint: string
  readonly isLive: (handle: Handle) => boolean
  readonly open: Effect.Effect<Handle, StorageDomainOpenFailed, R>
  readonly close: (handle: Handle) => Effect.Effect<void>
}): Effect.Effect<Handle, StorageDomainOpenFailed, R | Scope.Scope> =>
  Effect.acquireRelease(
    Effect.suspend(() => {
      const handles = sharedHandles()
      // SAFETY: entries under one key are only ever written below with this key's Handle type.
      const existing = handles.get(input.key) as SharedHandle<Handle> | undefined
      if (
        existing !== undefined &&
        !existing.holders.has(input.holder) &&
        existing.fingerprint === input.fingerprint &&
        input.isLive(existing.handle)
      ) {
        existing.holders.add(input.holder)
        return Effect.succeed(existing)
      }
      // A second open within one activation is a bug that waiting cannot fix: let the facility refuse it at once.
      const sameHolder = existing?.holders.has(input.holder) === true
      return Effect.map(sameHolder ? input.open : openWaitingForClose(input.open), handle => {
        const entry: SharedHandle<Handle> = { handle, fingerprint: input.fingerprint, holders: new Set([input.holder]) }
        handles.set(input.key, entry)
        return entry
      })
    }),
    entry =>
      Effect.suspend(() => {
        entry.holders.delete(input.holder)
        if (entry.holders.size > 0) return Effect.void
        const handles = sharedHandles()
        if (handles.get(input.key) === entry) handles.delete(input.key)
        return input.close(entry.handle)
      }),
  ).pipe(Effect.map(entry => entry.handle))

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
        const domain = yield* acquireSharedHandle({
          key: `${host.packageId}\u0000${spec.name}`,
          holder: host.ctx,
          fingerprint: fingerprintOf(spec),
          // The facility's diagnostic lookup returns its own untyped runtime object for the same handle.
          isLive: handle => (facility.get(spec.name) as unknown) === handle,
          open: Effect.tryPromise({
            try: () => facility.open(spec),
            catch: cause => new StorageDomainOpenFailed({ domain: spec.name, code: codeOf(cause), cause }),
          }),
          close: opened => Effect.tryPromise(() => opened.close()).pipe(Effect.ignore({ log: 'Warn', message: `storage domain ${spec.name} did not close cleanly` })),
        })
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
