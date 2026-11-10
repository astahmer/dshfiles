import { Clock, Context, Effect, FileSystem, Layer, Path } from 'effect'
import { ProjectIcon, type ResolvedProjectIcon } from './project-icon.js'

/**
 * A project's icon, resolved from the Host cache. One cache lives as long as the plugin, so the icon file is read once
 * per documented TTL instead of once per request; the client asks for every project row it paints.
 */
export class ProjectIcons extends Context.Service<
  ProjectIcons,
  { readonly read: (input: { readonly path: string; readonly title?: string | undefined }) => Effect.Effect<ResolvedProjectIcon> }
>()('@dshfiles/workspace-folder-picker/ProjectIcons') {
  static readonly layer = Layer.effect(
    ProjectIcons,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const icons = yield* ProjectIcon.cache({ fs, path })

      const read = Effect.fn('project icon')(function* (input: { readonly path: string; readonly title?: string | undefined }) {
        const now = yield* Clock.currentTimeMillis
        return yield* icons.read({ workspaceRoot: input.path, title: input.title ?? path.basename(input.path), now })
      })

      return ProjectIcons.of({ read })
    }),
  )
}
