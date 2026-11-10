import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Cache, Context, Duration, Effect, FileSystem, Layer, Path } from 'effect'

import { ProjectPaths } from './project-path.ts'
import { ensureProjectScripts, type WorkspaceScripts as Scripts } from './project-scripts.ts'

/**
 * How long one project's scripts answer from memory. Every model request asks for them, so a hit must touch no file;
 * a deleted script or a new lockfile is picked up after this, not on the next turn.
 */
export const workspaceScriptsTtl = Duration.minutes(5)

/** A thread workspace's project scripts, or null outside a project with a lockfile or when they cannot be written. */
export class WorkspaceScripts extends Context.Service<WorkspaceScripts, { readonly forCwd: (cwd: string | undefined) => Effect.Effect<Scripts | null> }>()(
  '@dshfiles/memory/WorkspaceScripts',
) {
  static readonly layer = (root = dshHomePath('plugins', 'memory', 'projects')) =>
    Layer.effect(
      WorkspaceScripts,
      Effect.gen(function* () {
        const projects = yield* ProjectPaths
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const scriptsOf = yield* Cache.make({
          capacity: 256,
          timeToLive: workspaceScriptsTtl,
          lookup: (project: string) =>
            ensureProjectScripts({ root, project }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
              Effect.catchCause(cause => Effect.logDebug('memory: workspace scripts were not written', cause).pipe(Effect.as(null))),
            ),
        })
        return WorkspaceScripts.of({
          forCwd: cwd => (cwd === undefined ? Effect.succeed(null) : Effect.flatMap(projects.of(cwd), project => Cache.get(scriptsOf, project))),
        })
      }),
    )
}
