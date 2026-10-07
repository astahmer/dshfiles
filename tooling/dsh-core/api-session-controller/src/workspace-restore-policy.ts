import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export interface WorkspaceRestoreOwner {
  readonly sessionId: string
  readonly archived: boolean
  readonly running: boolean
}

const pathContains = (parent: string, candidate: string): boolean => {
  const fromParent = relative(parent, candidate)
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
}

export const workspaceRootsOverlap = (first: string, second: string): boolean =>
  pathContains(first, second) || pathContains(second, first)

export const assertCanonicalWorkspaceRoot = async (root: string): Promise<void> => {
  if (!isAbsolute(root) || resolve(root) !== root) {
    throw new Error('Restore workspace root must be canonical and absolute.')
  }
  if (await realpath(root) !== root) throw new Error('Restore workspace root cannot contain a symbolic link path.')
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Restore workspace root cannot be a symbolic link.')
}

export const assertWorkspaceRestoreOwner = (
  sessionId: string,
  owners: readonly WorkspaceRestoreOwner[],
): void => {
  const selected = owners.find(owner => owner.sessionId === sessionId)
  if (selected === undefined || selected.archived) throw new Error('Restore requires a non-archived Session attached to this workspace.')
  if (selected.running) throw new Error('Restore is unavailable while the selected Session Agent is running.')
  const otherOwner = owners.find(owner => owner.sessionId !== sessionId && (!owner.archived || owner.running))
  if (otherOwner !== undefined) throw new Error('Restore is unavailable while another Session owns this workspace.')
}

export const assertNoOverlappingWorkspaceRoots = (root: string, otherRoots: readonly string[]): void => {
  if (!isAbsolute(root) || resolve(root) !== root) throw new Error('Restore workspace root must be canonical and absolute.')
  if (otherRoots.some(other => !isAbsolute(other) || resolve(other) !== other)) {
    throw new Error('Every compared workspace root must be canonical and absolute.')
  }
  const overlap = otherRoots.find(other => workspaceRootsOverlap(root, other))
  if (overlap !== undefined) throw new Error('Restore is unavailable while another workspace overlaps this path.')
}

export const assertNoSymlinkWorkspacePath = async (root: string, relativePath: string): Promise<void> => {
  await assertCanonicalWorkspaceRoot(root)
  if (
    relativePath.length === 0
    || relativePath.includes('\0')
    || relativePath.includes('\\')
    || relativePath.startsWith('/')
  ) {
    throw new Error('Restore path must be a non-empty workspace-relative file path.')
  }
  const segments = relativePath.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new Error('Restore path must not contain traversal or drive syntax.')
  }

  let current = root
  for (const segment of segments) {
    current = resolve(current, segment)
    if (!pathContains(root, current)) throw new Error('Restore path escapes its workspace.')
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Restore path crosses a symbolic link.')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
  }
}
