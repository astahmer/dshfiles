import { Clock, Context, Effect, Layer } from 'effect'
import { FolderInspector } from './folder-inspection.js'
import type { FolderInspection } from './project-lifecycle-api.js'

/** One folder's repository identity, as `project_identities` answers it. */
export interface ProjectIdentity {
  readonly path: string
  readonly key: string
  readonly remoteUrl: string | null
  readonly repositoryRoot: string | null
}

/**
 * A checkout's origin and root change only when someone edits that checkout, while the sidebar re-reads every project
 * folder each time the workspace list changes; a minute keeps a burst of new thread workspaces from re-running git per
 * folder without hiding an origin added in one.
 */
export const PROJECT_IDENTITY_TTL_MS = 60_000

const identityOf = (path: string, inspection: FolderInspection | null): ProjectIdentity =>
  inspection === null
    ? { path, key: path, remoteUrl: null, repositoryRoot: null }
    : {
        path,
        key: inspection.remoteUrl ?? inspection.repositoryRoot ?? inspection.path,
        remoteUrl: inspection.remoteUrl,
        repositoryRoot: inspection.repositoryRoot,
      }

/**
 * Repository identity per project folder, cached on the Host. The read is a full inspection (a stat per ancestor plus
 * the checkout's git reads), so the same folder is inspected once per minute rather than once per caller.
 */
export class ProjectIdentities extends Context.Service<
  ProjectIdentities,
  { readonly read: (paths: readonly string[]) => Effect.Effect<readonly ProjectIdentity[]> }
>()('@dshfiles/workspace-folder-picker/ProjectIdentities') {
  static readonly layer = Layer.effect(
    ProjectIdentities,
    Effect.gen(function* () {
      const inspector = yield* FolderInspector
      const known = new Map<string, { readonly at: number; readonly identity: ProjectIdentity }>()

      const identityFor = Effect.fn('project identity')(function* (path: string, now: number) {
        const cached = known.get(path)
        if (cached !== undefined && now - cached.at < PROJECT_IDENTITY_TTL_MS) return cached.identity
        const identity = yield* inspector.inspect(path).pipe(
          Effect.map(inspection => identityOf(path, inspection)),
          Effect.orElseSucceed(() => identityOf(path, null)),
        )
        known.set(path, { at: now, identity })
        return identity
      })

      const read = Effect.fn('project identities')(function* (paths: readonly string[]) {
        const now = yield* Clock.currentTimeMillis
        return yield* Effect.forEach(paths, path => identityFor(path, now), { concurrency: 4 })
      })

      return ProjectIdentities.of({ read })
    }),
  )
}
