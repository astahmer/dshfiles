import { Cache, Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Ref, type PlatformError } from 'effect'
import type { JjRunError } from './errors.ts'
import { Jj, type JjCommand, type JjOutput } from './jj.ts'
import { storeRootOf } from './store-root.ts'
import { trackViewRead, type TrackedViewReads, type ViewReadKey } from './view-read-tracker.ts'

/** Subcommands that only read the repository view, whose output is a function of the operation head. */
const VIEW_READS: readonly (readonly string[])[] = [['log'], ['root'], ['diff'], ['show'], ['workspace', 'list'], ['bookmark', 'list'], ['op', 'log']]

const MAX_ENTRIES = 512
const MAX_STORES = 256
const MAX_COMMIT_ADDRESSED_ENTRIES = 256

const REVISION_FLAGS = new Set(['-r', '--revisions', '-f', '--from', '-t', '--to'])
const COMMIT_ID_UNION = /^[0-9a-f]{40,}(?:\s*\|\s*[0-9a-f]{40,})*$/u

const isViewRead = (args: readonly string[]): boolean => {
  if (args[0] !== '--ignore-working-copy') return false
  const command = args.slice(1)
  return VIEW_READS.some(prefix => prefix.every((part, index) => command[index] === part))
}

/**
 * A `diff` whose every revision is a full commit id: a commit id names its tree and parents, so the output is the same at
 * any operation head and the read need not wait for the store to stay still.
 */
const isCommitAddressed = (args: readonly string[]): boolean => {
  if (args[0] !== '--ignore-working-copy' || args[1] !== 'diff') return false
  let revisions = 0
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument.startsWith('--revisions=') || argument.startsWith('--from=') || argument.startsWith('--to=')) return false
    if (!REVISION_FLAGS.has(argument)) continue
    const value = args[index + 1]
    if (value === undefined || !COMMIT_ID_UNION.test(value.trim())) return false
    revisions += 1
    index += 1
  }
  return revisions > 0
}

/**
 * Memoizes `jj --ignore-working-copy` view reads per operation head. Every jj spawn loads the repository view first,
 * which costs 80–340 ms on a store with dozens of workspaces, while these reads only change when an operation lands.
 * The key carries the store's `op_heads/heads` listing, read before the command runs, so a later operation misses
 * the cache and an operation landing mid-read is paired with the older head. Entries the moved head made unreachable
 * are invalidated for that store only, so a long-lived Host does not retain every result it ever computed.
 * Concurrent identical reads share one jj process, which keeps running until its last waiter is interrupted. A diff
 * over full commit ids is the same at every head, so it survives operations (bounded LRU).
 */
export class JjViewReads extends Context.Service<
  JjViewReads,
  {
    /** Run a view read (see `isViewRead`) or answer it from the same read at the same operation head; other commands run uncached. */
    readonly read: (command: JjCommand) => Effect.Effect<JjOutput, JjRunError>
  }
>()('@dshfiles/jj-cli/JjViewReads') {
  static readonly isViewRead = isViewRead
  static readonly isCommitAddressed = isCommitAddressed

  static readonly make = Effect.gen(function* () {
    const jj = yield* Jj
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const findOperationHeadsDirectory = (directory: string): Effect.Effect<Option.Option<string>, PlatformError.PlatformError> =>
      Effect.gen(function* () {
        const store = yield* storeRootOf(directory).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, path))
        if (store !== undefined) return Option.some(path.join(store, 'op_heads', 'heads'))
        const parent = path.dirname(directory)
        if (parent === directory) return Option.none<string>()
        return yield* findOperationHeadsDirectory(parent)
      })

    const operationHeadsDirectories = yield* Cache.make({
      lookup: (cwd: string) => findOperationHeadsDirectory(path.resolve(cwd)).pipe(Effect.orElseSucceed(() => Option.none<string>())),
      capacity: MAX_STORES,
    })

    const operationHeads = (cwd: string) =>
      Cache.get(operationHeadsDirectories, cwd).pipe(
        Effect.flatMap(directory =>
          Option.isNone(directory)
            ? Effect.succeed(Option.none<{ readonly store: string; readonly heads: string }>())
            : fileSystem.readDirectory(directory.value).pipe(
                Effect.map(heads => Option.some({ store: directory.value, heads: [...heads].sort().join(',') })),
                Effect.orElseSucceed(() => Option.none<{ readonly store: string; readonly heads: string }>()),
              ),
        ),
      )

    const results = yield* Cache.makeWith((key: ViewReadKey) => jj.run(key.command), {
      capacity: MAX_ENTRIES,
      timeToLive: exit => (Exit.isSuccess(exit) && exit.value.exitCode === 0 ? Duration.infinity : Duration.zero),
    })
    const tracked = yield* Ref.make<TrackedViewReads>(new Map())
    const commitAddressed = yield* Cache.makeWith((command: JjCommand) => jj.run(command), {
      capacity: MAX_COMMIT_ADDRESSED_ENTRIES,
      timeToLive: exit => (Exit.isSuccess(exit) && exit.value.exitCode === 0 ? Duration.infinity : Duration.zero),
    })

    const read = Effect.fnUntraced(function* (command: JjCommand) {
      if (!isViewRead(command.args)) return yield* jj.run(command)
      if (isCommitAddressed(command.args)) return yield* Cache.get(commitAddressed, command)
      const observed = yield* operationHeads(command.cwd)
      if (Option.isNone(observed)) return yield* jj.run(command)
      const { store, heads } = observed.value
      const key: ViewReadKey = { operationHeads: heads, command }
      const invalidated = yield* Ref.modify(tracked, current => {
        const trackedRead = trackViewRead(current, { store, heads, key })
        return [trackedRead.invalidated, trackedRead.next] as const
      })
      yield* Effect.forEach(invalidated, stale => Cache.invalidate(results, stale), { discard: true })
      const value = yield* Cache.get(results, key)
      // A read still in flight when the operation landed re-inserts its entry after the invalidation above.
      const current = yield* Ref.get(tracked).pipe(Effect.map(state => state.get(store)?.heads === heads))
      if (!current) yield* Cache.invalidate(results, key)
      return value
    })

    return JjViewReads.of({ read })
  })

  static readonly layer = Layer.effect(JjViewReads, JjViewReads.make)
}
