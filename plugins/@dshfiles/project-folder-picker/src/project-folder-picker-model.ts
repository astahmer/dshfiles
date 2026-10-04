import type { ProjectFolderSelection, RegisteredProject } from './project-folder-picker.js'

export type PickerDirection = 'up' | 'down'

export const filterRegisteredProjects = (projects: readonly RegisteredProject[], query: string): readonly RegisteredProject[] => {
  if (query.startsWith('/')) return []
  const search = query.trim().toLocaleLowerCase()
  if (search.length === 0) return projects
  return projects.filter(project => `${project.title} ${project.canonicalPath}`.toLocaleLowerCase().includes(search))
}

export const movePickerSelection = (current: number, count: number, direction: PickerDirection): number => {
  if (count < 1) return 0
  const delta = direction === 'down' ? 1 : -1
  return (current + delta + count) % count
}

export const workspaceSelection = (project: RegisteredProject): ProjectFolderSelection => ({
  kind: 'workspace',
  workspaceId: project.workspaceId,
  canonicalPath: project.canonicalPath,
  title: project.title,
})

export const folderSelection = (canonicalPath: string): ProjectFolderSelection => ({
  kind: 'directory',
  canonicalPath,
  title: canonicalPath.split('/').filter(Boolean).at(-1) ?? canonicalPath,
})
