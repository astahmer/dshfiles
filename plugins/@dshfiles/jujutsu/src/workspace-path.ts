import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { workspaceNameSchema } from './api.js'
import { validatedRepositoryPath } from './core.js'

const pathContains = (parentPath: string, candidatePath: string): boolean => {
  const relativePath = relative(parentPath, candidatePath)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith('..' + sep) && !isAbsolute(relativePath))
}

export const resolveWorkspaceDestination = async (
  repositoryPath: string,
  selectedParentPath: string,
  name: string,
): Promise<{ readonly parentPath: string; readonly path: string }> => {
  if (!workspaceNameSchema.safeParse(name).success) throw new Error('Choose a valid Jujutsu workspace name.')
  const parentPath = await realpath(validatedRepositoryPath(selectedParentPath))
  if (!(await stat(parentPath)).isDirectory()) throw new Error('Choose an existing parent directory for the new workspace.')
  const repositoryRoot = await realpath(repositoryPath)
  const destination = join(parentPath, name)
  if (pathContains(repositoryRoot, destination) || pathContains(destination, repositoryRoot)) {
    throw new Error('Choose a sibling workspace path outside the registered repository tree.')
  }
  try {
    await lstat(destination)
    throw new Error('Workspace destination already exists. Choose a new directory name.')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  return { parentPath, path: destination }
}
