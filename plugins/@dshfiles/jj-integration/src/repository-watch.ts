import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect, FileSystem, Layer, Path, Ref, Stream } from 'effect'
import { jjIntegrationApi } from './api.js'
import { RepositoryViews, type ScannedRepository } from './repository-views.js'

/**
 * A burst of jj operations (an agent's `jj new` then `jj describe`, a land's rebase then bookmark move) is one event,
 * sent at most once a second, a second after the first change, as background-jobs does for its board.
 */
const CHANGE_EVENT_INTERVAL = '1 second'
/** The event names the thread workspaces to read again; a repository with more is cut, and the poll covers the rest. */
const MAX_EVENT_PATHS = 2_000

/** Every jj operation, in any workspace of a repository, rewrites the store's operation heads. */
const operationHeadsOf = (path: Path.Path, repoRoot: string): string => path.join(repoRoot, '.jj', 'repo', 'op_heads', 'heads')

const watchKey = (repositories: readonly ScannedRepository[]): string =>
  [...repositories.map(repository => repository.repoRoot)].sort()
    .join('\n')

/**
 * Round three item 28: tell browsers when a scanned repository's revisions change, so an open thread header shows Land
 * within a second of `jj describe` instead of on its one-minute idle poll (34 s measured on a phone).
 *
 * It watches one directory per repository the last scan named (the store's `op_heads/heads`, which every jj operation
 * rewrites), restarts the watches only when that set of repositories changes, and runs no jj itself: a browser that
 * hears the event reads only the threads it shows. A repository whose store cannot be watched (git-only, removed) is
 * skipped; its threads keep the poll.
 */
export const RepositoryWatch = Layer.effectDiscard(
  Effect.gen(function* () {
    const views = yield* RepositoryViews
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const pathsByRepository = yield* Ref.make<ReadonlyMap<string, readonly string[]>>(new Map())

    const watchRepository = (repoRoot: string): Stream.Stream<string> =>
      fileSystem.watch(operationHeadsOf(path, repoRoot)).pipe(
        Stream.map(() => repoRoot),
        Stream.catchCause(() => Stream.empty),
      )

    const publish = Effect.fn('jj-integration repository changed')(function* (changed: readonly string[]) {
      const byRepository = yield* Ref.get(pathsByRepository)
      const repositories = [...new Set(changed)]
      const paths = [...new Set(repositories.flatMap(repoRoot => byRepository.get(repoRoot) ?? []))].slice(0, MAX_EVENT_PATHS)
      yield* Effect.annotateCurrentSpan({ 'jj.repositories': repositories.length, 'jj.paths': paths.length })
      if (paths.length === 0) return
      yield* Api.publish({ contract: jjIntegrationApi, event: 'repositoryChanged', payload: { paths } }).pipe(
        Effect.catchTag('PublishEventError', error => Effect.logWarning('jj-integration: repository change event refused', error.message)),
      )
    })

    yield* views.scanned.pipe(
      Stream.tap(repositories => Ref.set(pathsByRepository, new Map(repositories.map(repository => [repository.repoRoot, repository.paths])))),
      Stream.map(watchKey),
      Stream.changes,
      Stream.switchMap(key => (key === '' ? Stream.empty : Stream.mergeAll(key.split('\n').map(watchRepository), { concurrency: 'unbounded' }))),
      Stream.groupedWithin(Number.MAX_SAFE_INTEGER, CHANGE_EVENT_INTERVAL),
      Stream.runForEach(publish),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)
