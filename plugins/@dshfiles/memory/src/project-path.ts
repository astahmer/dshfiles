import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Cache, Context, Deferred, Effect, FileSystem, Layer, Path } from 'effect'

import { MemoryRepo } from './memory-repo.ts'

/** Secondary JJ workspaces point at the owning checkout's store; memory should use that project path. */
const jjProjectRootAt = Effect.fnUntraced(function* (workspaceRoot: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const pointerPath = path.join(workspaceRoot, '.jj', 'repo')
  const metadata = yield* Effect.option(fs.stat(pointerPath))
  if (metadata._tag === 'None') return undefined
  if (metadata.value.type === 'Directory') return workspaceRoot
  if (metadata.value.type !== 'File' || Number(metadata.value.size) > 4_096) return undefined
  const pointer = (yield* fs.readFileString(pointerPath).pipe(Effect.orElseSucceed(() => ''))).trim()
  if (pointer.length === 0) return undefined
  const storePath = path.resolve(path.dirname(pointerPath), pointer)
  if (path.basename(storePath) !== 'repo' || path.basename(path.dirname(storePath)) !== '.jj') return undefined
  const store = yield* Effect.option(fs.stat(storePath))
  if (store._tag === 'None' || store.value.type !== 'Directory') return undefined
  return path.dirname(path.dirname(storePath))
})

/** The project a working directory belongs to: its canonical path, or the owning checkout of a JJ workspace. */
export const projectPathFor = Effect.fn('memory project path')(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const canonical = yield* fs.realPath(cwd).pipe(Effect.orElseSucceed(() => path.resolve(cwd)))
  let directory = canonical
  while (true) {
    const projectRoot = yield* jjProjectRootAt(directory)
    if (projectRoot !== undefined) return yield* fs.realPath(projectRoot).pipe(Effect.orElseSucceed(() => path.resolve(projectRoot)))
    const parent = path.dirname(directory)
    if (parent === directory) return canonical
    directory = parent
  }
})

/** Rewrites rows stored under a JJ workspace path to their project path, once per activation. */
const normalizeStoredProjects = Effect.fn('memory normalize project paths')(function* (paths: (cwd: string) => Effect.Effect<string>) {
  const repo = yield* MemoryRepo
  const path = yield* Path.Path
  const stored = (yield* repo.projectPaths).filter(from => path.isAbsolute(from))
  const resolved = yield* Effect.forEach(stored, from => Effect.map(paths(from), to => ({ from, to })))
  const mappings = resolved.filter(mapping => mapping.to !== mapping.from)
  const result = yield* repo.rekeyProjects({ mappings })
  if (result.projects > 0)
    yield* Effect.logInfo(
      `memory: normalized ${result.projects} JJ workspace path(s): ${result.moved.threads} digest(s), ${result.moved.notes} note(s), ${result.moved.messages} indexed message(s)`,
    )
  if (result.conflicts.length > 0)
    yield* Effect.logWarning(`memory: left ${result.conflicts.length} JJ workspace path(s) separate due to duplicate note or digest hashes`)
})

/**
 * The project of each working directory, resolved once per directory. Reads wait for the activation's one pass that
 * rekeys stored workspace paths, so a lookup never files new rows under a path that pass is about to move.
 */
export class ProjectPaths extends Context.Service<
  ProjectPaths,
  {
    readonly of: (cwd: string | undefined) => Effect.Effect<string>
    /** Completes once stored workspace paths are rekeyed (or that pass failed and left them). */
    readonly ready: Effect.Effect<void>
  }
>()('@dshfiles/memory/ProjectPaths') {
  static readonly layer = Layer.effect(
    ProjectPaths,
    Effect.gen(function* () {
      const resolved = yield* Cache.make({ capacity: 4_096, lookup: projectPathFor })
      const normalized = yield* Deferred.make<void>()
      yield* DshxPlugin.worker(
        normalizeStoredProjects(cwd => Cache.get(resolved, cwd)).pipe(
          Effect.catchCause(cause => Effect.logWarning('memory: JJ workspace memory backfill failed; remaining entries stay separate', cause)),
          Effect.ensuring(Deferred.succeed(normalized, undefined)),
        ),
      )
      const ready = Deferred.await(normalized)
      return ProjectPaths.of({
        ready,
        of: cwd => (cwd === undefined || cwd.length === 0 ? Effect.succeed('unknown') : Effect.andThen(ready, Cache.get(resolved, cwd))),
      })
    }),
  )
}
