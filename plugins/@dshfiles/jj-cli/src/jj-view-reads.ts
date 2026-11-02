import { Cache, Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, type PlatformError } from 'effect'
import type { JjRunError } from './errors.ts'
import { Jj, type JjCommand, type JjOutput } from './jj.ts'

/** Subcommands that only read the repository view, whose output is a function of the operation head. */
const VIEW_READS: readonly (readonly string[])[] = [['log'], ['root'], ['diff'], ['show'], ['workspace', 'list'], ['bookmark', 'list'], ['op', 'log']]

const MAX_ENTRIES = 512
const MAX_STORES = 256

interface ViewReadKey {
  readonly operationHeads: string
  readonly command: JjCommand
}

const isViewRead = (args: readonly string[]): boolean => {
  if (args[0] !== '--ignore-working-copy') return false
  const command = args.slice(1)
  return VIEW_READS.some(prefix => prefix.every((part, index) => command[index] === part))
}

/**
 * Memoizes `jj --ignore-working-copy` view reads per operation head. Every jj spawn loads the repository view first,
 * which costs 80–340 ms on a store with dozens of workspaces, while these reads only change when an operation lands.
 * The key carries the store's `op_heads/heads` listing, read before the command runs, so a later operation misses
 * the cache and an operation landing mid-read is paired with the older head. Concurrent identical reads share one
 * jj process, which keeps running until its last waiter is interrupted.
 */
export class JjViewReads extends Context.Service<
  JjViewReads,
  {
    /** Run a view read (see `isViewRead`) or answer it from the same read at the same operation head; other commands run uncached. */
    readonly read: (command: JjCommand) => Effect.Effect<JjOutput, JjRunError>
  }
>()('@dshfiles/jj-cli/JjViewReads') {
  static readonly isViewRead = isViewRead

  static readonly make = Effect.gen(function* () {
    const jj = yield* Jj
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const findOperationHeadsDirectory = (directory: string): Effect.Effect<Option.Option<string>, PlatformError.PlatformError> =>
      Effect.gen(function* () {
        const marker = path.join(directory, '.jj', 'repo')
        const info = yield* fileSystem.stat(marker).pipe(Effect.option)
        if (Option.isSome(info)) {
          const store = info.value.type === 'Directory' ? marker : path.resolve(directory, '.jj', (yield* fileSystem.readFileString(marker)).trim())
          return Option.some(path.join(store, 'op_heads', 'heads'))
        }
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
            ? Effect.succeed(Option.none<string>())
            : fileSystem.readDirectory(directory.value).pipe(
                Effect.map(heads => Option.some([...heads].sort().join(','))),
                Effect.orElseSucceed(() => Option.none<string>()),
              ),
        ),
      )

    const results = yield* Cache.makeWith((key: ViewReadKey) => jj.run(key.command), {
      capacity: MAX_ENTRIES,
      timeToLive: exit => (Exit.isSuccess(exit) && exit.value.exitCode === 0 ? Duration.infinity : Duration.zero),
    })

    const read = Effect.fnUntraced(function* (command: JjCommand) {
      if (!isViewRead(command.args)) return yield* jj.run(command)
      const heads = yield* operationHeads(command.cwd)
      if (Option.isNone(heads)) return yield* jj.run(command)
      return yield* Cache.get(results, { operationHeads: heads.value, command })
    })

    return JjViewReads.of({ read })
  })

  static readonly layer = Layer.effect(JjViewReads, JjViewReads.make)
}
