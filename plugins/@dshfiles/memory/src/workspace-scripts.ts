import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Context, Effect, type FileSystem, Layer, type Path } from 'effect'

import { projectPathFor } from './project-path.ts'
import { ensureProjectScripts, type WorkspaceScripts as Scripts } from './project-scripts.ts'

/** A thread workspace's project scripts, or null outside a project with a lockfile or when they cannot be written. */
export class WorkspaceScripts extends Context.Service<
  WorkspaceScripts,
  { readonly forCwd: (cwd: string | undefined) => Effect.Effect<Scripts | null, never, FileSystem.FileSystem | Path.Path> }
>()('@dshfiles/memory/WorkspaceScripts') {
  static readonly layer = (root = dshHomePath('plugins', 'memory', 'projects')) =>
    Layer.succeed(
      WorkspaceScripts,
      WorkspaceScripts.of({
        forCwd: cwd => {
          if (cwd === undefined) return Effect.succeed(null)
          return Effect.flatMap(projectPathFor(cwd), project => ensureProjectScripts({ root, project })).pipe(
            Effect.catchCause(cause => Effect.logDebug('memory: workspace scripts were not written', cause).pipe(Effect.as(null))),
          )
        },
      }),
    )
}
