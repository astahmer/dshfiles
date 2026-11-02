import { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import BrowseDirectoryPicker from '@deepseek-ai/dsh-host-directory-picker-browse'
import type {} from '@deepseek-ai/dsh-subprocess'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { ExecutableLookup, ProjectRegistry, ProjectRegisterFailed } from './project-lifecycle.js'

type BrowseCapability = Extract<ReturnType<BrowseDirectoryPicker['capability']>, { kind: 'browse' }>
type DirectoryListing = Awaited<ReturnType<BrowseCapability['list']>>
type CreatedDirectory = Awaited<ReturnType<BrowseCapability['createDirectory']>>

export class DirectoryUnreadable extends Schema.TaggedError<DirectoryUnreadable>()(
  'DirectoryUnreadable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'directory-unreadable' },
) {
  override get message(): string {
    return 'Could not open this folder.'
  }
}

export class DirectoryAlreadyExists extends Schema.TaggedError<DirectoryAlreadyExists>()(
  'DirectoryExists',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'directory-exists' },
) {
  override get message(): string {
    return 'A folder with that name already exists.'
  }
}

export class DirectoryCreateFailed extends Schema.TaggedError<DirectoryCreateFailed>()(
  'DirectoryCreateFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'directory-create-failed' },
) {
  override get message(): string {
    return 'Could not create this folder.'
  }
}

/** The native browse picker did not offer its browse capability, so the folder browser cannot start. */
export class DirectoryBrowserUnavailable extends Schema.TaggedError<DirectoryBrowserUnavailable>()('DirectoryBrowserUnavailable', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The directory browser did not provide its browse capability. Update DSH, then restart it.'
  }
}

export class ProjectRemoveFailed extends Schema.TaggedError<ProjectRemoveFailed>()(
  'ProjectRemoveFailed',
  { workspaceId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'project-remove-failed' },
) {
  override get message(): string {
    return `Project ${this.workspaceId} could not be removed. Reload the project list and retry.`
  }
}

/**
 * The native browse directory picker, on a Cordis context of its own so it never replaces the Host's picker, open for
 * the plugin Scope.
 */
export class DirectoryBrowser extends Context.Service<
  DirectoryBrowser,
  {
    readonly list: (path: string | undefined) => Effect.Effect<DirectoryListing, DirectoryUnreadable>
    readonly createDirectory: (input: {
      readonly path: string
      readonly name: string
    }) => Effect.Effect<CreatedDirectory, DirectoryAlreadyExists | DirectoryCreateFailed>
  }
>()('@dshfiles/workspace-folder-picker/DirectoryBrowser') {
  static readonly layer = Layer.effect(
    DirectoryBrowser,
    Effect.gen(function* () {
      const browseContext = yield* Effect.acquireRelease(
        Effect.sync(() => new CordisContext()),
        context => Effect.promise(() => context.fiber.dispose()),
      )
      const capability = new BrowseDirectoryPicker(browseContext, { maxEntries: 1_000 }).capability()
      if (capability.kind !== 'browse') return yield* new DirectoryBrowserUnavailable({})
      return DirectoryBrowser.of({
        list: Effect.fn('workspace folder browse')(function* (path: string | undefined) {
          return yield* Effect.tryPromise({ try: signal => capability.list(path, signal), catch: cause => new DirectoryUnreadable({ cause }) })
        }),
        createDirectory: Effect.fn('workspace folder create directory')(function* (input: { readonly path: string; readonly name: string }) {
          return yield* Effect.tryPromise({
            try: () => capability.createDirectory(input.path, input.name),
            catch: cause =>
              cause instanceof DirectoryPickerError && cause.code === 'directory-exists'
                ? new DirectoryAlreadyExists({ cause })
                : new DirectoryCreateFailed({ cause }),
          })
        }),
      })
    }),
  )
}

export const executableLookupLayer = Layer.effect(
  ExecutableLookup,
  Effect.gen(function* () {
    const host = yield* HostContext
    return ExecutableLookup.of({
      resolve: command =>
        Effect.tryPromise(signal => host.ctx.subprocess.resolveExecutable(command, undefined, signal)).pipe(
          Effect.map(Option.some),
          Effect.orElseSucceed(() => Option.none()),
        ),
    })
  }),
)

export const projectRegistryLayer = Layer.effect(
  ProjectRegistry,
  Effect.gen(function* () {
    const host = yield* HostContext
    return ProjectRegistry.of({
      register: Effect.fn('project register')(function* (path: string) {
        const created = yield* Effect.tryPromise({
          try: () => host.ctx.workspaceController.create({ path }),
          catch: cause => new ProjectRegisterFailed({ path, cause }),
        })
        return { workspaceId: created.workspace.workspaceId, title: created.workspace.title, path: created.workspace.path }
      }),
    })
  }),
)

/** Removes a project from the DSH workspace registry; its folder stays on disk. */
export class ProjectRemover extends Context.Service<
  ProjectRemover,
  { readonly remove: (workspaceId: string) => Effect.Effect<{ readonly workspaceId: string; readonly removed: true }, ProjectRemoveFailed> }
>()('@dshfiles/workspace-folder-picker/ProjectRemover') {
  static readonly layer = Layer.effect(
    ProjectRemover,
    Effect.gen(function* () {
      const host = yield* HostContext
      return ProjectRemover.of({
        remove: Effect.fn('project remove')(function* (workspaceId: string) {
          const id = WorkspaceId(workspaceId)
          yield* Effect.tryPromise({
            try: () => host.ctx.workspaceController.delete({ workspaceId: id }),
            catch: cause => new ProjectRemoveFailed({ workspaceId, cause }),
          })
          return { workspaceId: id, removed: true as const }
        }),
      })
    }),
  )
}
