import { JjFilesystem } from './jj-filesystem.js'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const contains = (parent: string, candidate: string): boolean => {
  const relativePath = relative(parent, candidate)
  return relativePath === '' || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
}

const includes = (input: { readonly filesystem: typeof JjFilesystem; readonly workspacePath: string; readonly sessionCwd: string | undefined }): boolean => {
  if (input.sessionCwd === undefined || !isAbsolute(input.sessionCwd)) return false
  const candidates = [resolve(input.sessionCwd)]
  const workspaceRoots = [resolve(input.workspacePath)]
  try {
    candidates.push(input.filesystem.realpathSync(input.sessionCwd))
  } catch {
    // A removed nested cwd can still be lexically inside the workspace.
  }
  try {
    workspaceRoots.push(input.filesystem.realpathSync(input.workspacePath))
  } catch {
    // Preserve lexical matching when a workspace root is temporarily unavailable.
  }
  return workspaceRoots.some(parent => candidates.some(candidate => contains(parent, candidate)))
}

export class WorkspaceSessionPath {
  static readonly includes = includes
}
