import { Effect, FileSystem, Option, Path, Schema } from 'effect'
import { workspaceNameSchema } from './api.js'
import { JujutsuPathModel } from './core.js'
import { WorkspaceDestinationInvalid } from './errors.js'

export interface WorkspaceParentIdentity {
  readonly device: string
  readonly inode: string
}

const isWorkspaceName = Schema.is(workspaceNameSchema)

export const sameWorkspaceParent = (left: WorkspaceParentIdentity, right: WorkspaceParentIdentity): boolean =>
  left.device === right.device && left.inode === right.inode

/** A new workspace folder: a fresh sibling of the repository under an existing, canonical parent directory. */
export const resolveWorkspaceDestination = Effect.fnUntraced(function* (input: {
  readonly repositoryPath: string
  readonly selectedParentPath: string
  readonly name: string
}) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const invalid = (reason: WorkspaceDestinationInvalid['reason']) => (cause: unknown) => new WorkspaceDestinationInvalid({ reason, cause })
  const pathContains = (parentPath: string, candidatePath: string): boolean => {
    const relativePath = path.relative(parentPath, candidatePath)
    return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith('..' + path.sep) && !path.isAbsolute(relativePath))
  }
  if (!isWorkspaceName(input.name)) return yield* new WorkspaceDestinationInvalid({ reason: 'name' })
  const parentPath = yield* fileSystem
    .realPath(yield* Effect.fromResult(JujutsuPathModel.validatedRepositoryPath(input.selectedParentPath)))
    .pipe(Effect.mapError(invalid('parent')))
  const parentInfo = yield* fileSystem.stat(parentPath).pipe(Effect.mapError(invalid('parent')))
  if (parentInfo.type !== 'Directory') return yield* new WorkspaceDestinationInvalid({ reason: 'parent' })
  const repositoryRoot = yield* fileSystem.realPath(input.repositoryPath).pipe(Effect.mapError(invalid('inside-repository')))
  const destination = path.join(parentPath, input.name)
  if (pathContains(repositoryRoot, destination) || pathContains(destination, repositoryRoot))
    return yield* new WorkspaceDestinationInvalid({ reason: 'inside-repository' })
  const existing = yield* fileSystem.lstat(destination).pipe(
    Effect.map(Option.some),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
    Effect.mapError(invalid('exists')),
  )
  if (Option.isSome(existing)) return yield* new WorkspaceDestinationInvalid({ reason: 'exists' })
  return {
    parentPath,
    path: destination,
    parentIdentity: { device: String(parentInfo.dev), inode: String(Option.getOrElse(parentInfo.ino, () => 0n)) } satisfies WorkspaceParentIdentity,
  }
})
