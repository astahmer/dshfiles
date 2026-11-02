import { Effect, FileSystem, Option, Path } from 'effect'

/** Whether a Session's cwd lies inside a workspace, lexically or through symlinks resolved on disk. */
const includes = Effect.fnUntraced(function* (input: {
  readonly fileSystem: FileSystem.FileSystem
  readonly path: Path.Path
  readonly workspacePath: string
  readonly sessionCwd: string | undefined
}) {
  const fileSystem = input.fileSystem
  const path = input.path
  const sessionCwd = input.sessionCwd
  if (sessionCwd === undefined || !path.isAbsolute(sessionCwd)) return false
  const contains = (parent: string, candidate: string): boolean => {
    const relativePath = path.relative(parent, candidate)
    return relativePath === '' || (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`))
  }
  // A removed nested cwd, or a workspace root that is briefly unavailable, still matches lexically.
  const [realCwd, realWorkspace] = yield* Effect.all([
    fileSystem.realPath(sessionCwd).pipe(Effect.option),
    fileSystem.realPath(input.workspacePath).pipe(Effect.option),
  ])
  const candidates = [path.resolve(sessionCwd), ...Option.toArray(realCwd)]
  const workspaceRoots = [path.resolve(input.workspacePath), ...Option.toArray(realWorkspace)]
  return workspaceRoots.some(parent => candidates.some(candidate => contains(parent, candidate)))
})

export class WorkspaceSessionPath {
  static readonly includes = includes
}
