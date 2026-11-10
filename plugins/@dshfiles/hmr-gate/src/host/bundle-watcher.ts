import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { Duration, Effect, FiberMap, FileSystem, Queue, Schedule, Stream } from 'effect'

/** The bundle metadata the gate compares. */
export interface BundleStat {
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly size: number
}

/** One finished read of a watched bundle: its metadata, or the error `stat` raised. */
export type BundleRead = { readonly kind: 'stat'; readonly stat: BundleStat } | { readonly kind: 'error'; readonly error: unknown }

export interface BundleWatcherOptions {
  /** Called once per requested bundle after its read, in request order, never concurrently. */
  readonly onRead: (id: string, read: BundleRead) => void
  readonly onWatchError?: (error: unknown) => void
  /** Delay that coalesces the burst of events a build writes. */
  readonly settleMs?: number
  /** Re-reads every bundle in case a watch missed an event (network filesystems, overflow). */
  readonly safetyPollMs?: number
  /** Polling interval for a directory that cannot be watched, or vanished until it reappears. */
  readonly fallbackPollMs?: number
}

/** The synchronous controls the Host's callbacks drive; the watching itself runs in the program's scope. */
export interface BundleWatcher {
  /** Replace the watched set: bundle id → absolute bundle path. */
  sync(rows: ReadonlyMap<string, string>): void
  /** Read these bundles again soon, for example after a failed apply. */
  retry(ids: Iterable<string>): void
}

/** The bundle ids one watched directory holds. */
interface DirectoryEntry {
  readonly ids: Set<string>
}

const parentKey = (directory: string): string => `parent:${directory}`

/**
 * Watches the directories holding client bundles instead of polling every bundle on the Host's main thread. A
 * directory event schedules a `stat` of the matching bundles only. A directory that cannot be watched, or disappears
 * during a clean build, is polled until a watch can be reopened, and a slow safety poll covers events the platform
 * drops. Every watch, poll and read is a fiber of the caller's scope; closing it stops them all.
 */
const make = Effect.fnUntraced(function* (options: BundleWatcherOptions) {
  const fs = yield* FileSystem.FileSystem
  const settleMs = options.settleMs ?? 50
  const safetyPollMs = options.safetyPollMs ?? 10_000
  const fallbackPollMs = options.fallbackPollMs ?? 500
  const paths = new Map<string, string>()
  const directories = new Map<string, DirectoryEntry>()
  const pending = new Set<string>()
  /** Each item asks for a read of `pending` after that many milliseconds; the first request of a burst sets the delay. */
  const wake = yield* Queue.unbounded<number>()
  /** Signalled by `sync`: open and close directory watches to match `directories`. */
  const reconcile = yield* Queue.unbounded<void>()
  const watches = yield* FiberMap.make<string>()

  const request = (ids: Iterable<string>, delayMs: number = settleMs): void => {
    for (const id of ids) if (paths.has(id)) pending.add(id)
    if (pending.size > 0) Queue.offerUnsafe(wake, delayMs)
  }

  const reportWatchError = (error: unknown) => Effect.sync(() => options.onWatchError?.(error))

  /** Watch one directory until its watcher errors or closes; a directory that does not exist is left to the poll. */
  const watchDirectory = (directory: string, entry: DirectoryEntry) =>
    fs.watch(directory).pipe(
      Stream.runForEach(event =>
        Effect.sync(() => {
          const name = basename(event.path)
          request([...entry.ids].filter(id => basename(paths.get(id) ?? '') === name))
        }),
      ),
      Effect.catch(reportWatchError),
    )

  const openWatch = (directory: string, entry: DirectoryEntry): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* openParentWatch(directory, entry)
      if (yield* FiberMap.has(watches, directory)) return
      // A missing directory is the normal state during a clean build: poll it quietly instead of reporting an error.
      if (!(yield* fs.exists(directory).pipe(Effect.orElseSucceed(() => false)))) return
      yield* FiberMap.run(watches, directory, watchDirectory(directory, entry))
    })

  /** Watches the parent (the package directory), which survives a clean build that replaces `dist/`. */
  const openParentWatch = (directory: string, entry: DirectoryEntry): Effect.Effect<void> =>
    Effect.gen(function* () {
      const key = parentKey(directory)
      if (yield* FiberMap.has(watches, key)) return
      const parent = dirname(directory)
      if (!(yield* fs.exists(parent).pipe(Effect.orElseSucceed(() => false)))) return
      const name = basename(directory)
      yield* FiberMap.run(
        watches,
        key,
        fs.watch(parent).pipe(
          Stream.filter(event => basename(event.path) === name),
          // The bundle directory was removed or replaced: its own watch may be dead without an error.
          Stream.runForEach(() =>
            FiberMap.remove(watches, directory).pipe(Effect.andThen(openWatch(directory, entry)), Effect.andThen(Effect.sync(() => request(entry.ids)))),
          ),
          Effect.catch(reportWatchError),
        ),
      )
    })

  const readBundle = (id: string) =>
    Effect.gen(function* () {
      const path = paths.get(id)
      if (path === undefined) return undefined
      // Node's stat, not FileSystem.stat: the gate compares sub-millisecond mtime and ctime with the native artifact baseline.
      const read = yield* Effect.tryPromise(() => stat(path)).pipe(
        Effect.map((current): BundleRead => ({ kind: 'stat', stat: { mtimeMs: current.mtimeMs, ctimeMs: current.ctimeMs, size: current.size } })),
        Effect.catch(error => Effect.succeed<BundleRead>({ kind: 'error', error: error.cause })),
      )
      return [id, read] as const
    })

  /** Read everything pending, after the first requested delay of the burst; requests made meanwhile wait one settle. */
  const readPending = Effect.gen(function* () {
    const delayMs = yield* Queue.take(wake)
    if (pending.size === 0) return
    yield* Effect.sleep(Duration.millis(delayMs))
    yield* Queue.clear(wake)
    const ids = [...pending]
    pending.clear()
    const reads = yield* Effect.forEach(ids, readBundle, { concurrency: 'unbounded' })
    for (const read of reads) {
      if (read === undefined || !paths.has(read[0])) continue
      // A vanished bundle usually means a clean build removed its directory: drop the dead watch and poll.
      if (read[1].kind === 'error') yield* FiberMap.remove(watches, dirname(paths.get(read[0]) ?? ''))
      const [id, value] = read
      yield* Effect.sync(() => options.onRead(id, value))
    }
    yield* Queue.clear(wake)
    if (pending.size > 0) Queue.offerUnsafe(wake, settleMs)
  })

  const pollUnwatched = Effect.gen(function* () {
    for (const [directory, entry] of directories) {
      // Two map reads skip a healthy directory without suspending a fiber; this fallback poll runs over every watched directory twice a second.
      if (FiberMap.hasUnsafe(watches, parentKey(directory)) && FiberMap.hasUnsafe(watches, directory)) continue
      yield* openParentWatch(directory, entry)
      if (FiberMap.hasUnsafe(watches, directory)) continue
      yield* openWatch(directory, entry)
      request(entry.ids, 0)
    }
  })

  const reconcileWatches = Effect.gen(function* () {
    yield* Queue.take(reconcile)
    yield* Queue.clear(reconcile)
    for (const [key] of [...watches]) {
      const directory = key.startsWith('parent:') ? key.slice('parent:'.length) : key
      if (!directories.has(directory)) yield* FiberMap.remove(watches, key)
    }
    for (const [directory, entry] of directories) yield* openWatch(directory, entry)
  })

  yield* Effect.forkScoped(Effect.forever(readPending))
  yield* Effect.forkScoped(Effect.forever(reconcileWatches))
  yield* Effect.forkScoped(Effect.repeat(pollUnwatched, Schedule.spaced(Duration.millis(fallbackPollMs))).pipe(Effect.delay(Duration.millis(fallbackPollMs))))
  yield* Effect.forkScoped(
    Effect.repeat(
      Effect.sync(() => request(paths.keys())),
      Schedule.spaced(Duration.millis(safetyPollMs)),
    ).pipe(Effect.delay(Duration.millis(safetyPollMs))),
  )

  return {
    sync: rows => {
      paths.clear()
      for (const [id, path] of rows) paths.set(id, path)
      const wanted = new Map<string, Set<string>>()
      for (const [id, path] of paths) {
        const directory = dirname(path)
        const ids = wanted.get(directory) ?? new Set<string>()
        ids.add(id)
        wanted.set(directory, ids)
      }
      for (const directory of [...directories.keys()]) if (!wanted.has(directory)) directories.delete(directory)
      for (const [directory, ids] of wanted) {
        const entry = directories.get(directory) ?? { ids: new Set<string>() }
        entry.ids.clear()
        for (const id of ids) entry.ids.add(id)
        directories.set(directory, entry)
      }
      Queue.offerUnsafe(reconcile, undefined)
    },
    retry: ids => request(ids, fallbackPollMs),
  } satisfies BundleWatcher
})

export class BundleWatchProgram {
  static readonly make = make
}
