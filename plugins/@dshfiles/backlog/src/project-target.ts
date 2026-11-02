import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Context, Effect, Layer, Option } from 'effect'
import { HostWorkspaces } from './host-edge-promise.js'

export interface BacklogProjectTargetPorts {
  /** The registered workspace a directory belongs to: the session's cwd is the thread workspace itself, or below it. */
  readonly workspaceAt: (path: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly path: string }>>
  /** The project checkout that workspace was cut from, or none when the workspace is a project of its own. */
  readonly projectOf: (workspaceId: string) => Effect.Effect<Option.Option<{ readonly path: string }>>
}

/**
 * The project a capture made in `cwd` belongs to. jj studies the answer, not the folder name: a thread workspace is
 * whatever jj says was cut from a project, so a custom threads directory or a legacy workspace name still files the
 * item under its project. Without that answer the path stays as it is.
 */
export class BacklogProjectTarget {
  static readonly of = (cwd: string, ports: BacklogProjectTargetPorts): Effect.Effect<string> =>
    Effect.gen(function* () {
      const workspace = yield* ports.workspaceAt(cwd)
      if (Option.isNone(workspace)) return cwd
      const project = yield* ports.projectOf(workspace.value.id)
      if (Option.isNone(project) || project.value.path === workspace.value.path) return workspace.value.path
      return project.value.path
    })
}

/** Files an agent's capture under the project its working directory belongs to, through jj-integration when loaded. */
export class CaptureProjects extends Context.Service<CaptureProjects, { readonly of: (cwd: string) => Effect.Effect<string> }>()(
  '@dshfiles/backlog/CaptureProjects',
) {
  static readonly layer = Layer.effect(
    CaptureProjects,
    Effect.gen(function* () {
      const workspaces = yield* HostWorkspaces
      const jj = (yield* HostApis).client(jjIntegrationApi)
      const of = Effect.fn('backlog capture project')(function* (cwd: string) {
        const registered = yield* workspaces.list
        if (registered.length === 0) return cwd
        return yield* BacklogProjectTarget.of(cwd, {
          // A session may run in a subdirectory, so the deepest workspace holding the path owns it.
          workspaceAt: path =>
            Effect.succeed(
              Option.fromUndefinedOr(
                registered
                  .filter(candidate => path === candidate.path || path.startsWith(`${candidate.path}/`))
                  .sort((left, right) => right.path.length - left.path.length)
                  .map(holder => ({ id: holder.id, path: holder.path }))[0],
              ),
            ),
          projectOf: workspaceId =>
            jj.destination({ workspaceId }).pipe(
              Effect.map(destination =>
                Option.map(
                  Option.fromUndefinedOr(registered.find(candidate => candidate.id === destination.projectWorkspaceId)),
                  project => ({ path: project.path }),
                ),
              ),
              Effect.catch(error =>
                error.kind === 'unavailable'
                  ? Effect.succeedNone
                  : Effect.as(Effect.logWarning('backlog: the capture project target failed', error), Option.none<{ readonly path: string }>()),
              ),
            ),
        })
      })
      return CaptureProjects.of({ of })
    }),
  )
}
