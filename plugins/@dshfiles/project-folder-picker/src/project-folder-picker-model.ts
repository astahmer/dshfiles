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

export type PickerEntry = { readonly kind: 'project'; readonly project: RegisteredProject } | { readonly kind: 'recent'; readonly path: string }

/** Matching projects first, then recent folders that are not already registered projects. */
export const pickerEntries = (projects: readonly RegisteredProject[], recentFolders: readonly string[], query: string): readonly PickerEntry[] => {
  const matchingProjects = filterRegisteredProjects(projects, query)
  if (query.startsWith('/')) return []
  const search = query.trim().toLocaleLowerCase()
  const projectPaths = new Set(projects.map(project => project.canonicalPath))
  const recent = [...new Set(recentFolders)].filter(path => !projectPaths.has(path) && path.toLocaleLowerCase().includes(search))
  return [...matchingProjects.map((project): PickerEntry => ({ kind: 'project', project })), ...recent.map((path): PickerEntry => ({ kind: 'recent', path }))]
}

export const pickerEntrySelection = (entry: PickerEntry): ProjectFolderSelection =>
  entry.kind === 'project' ? workspaceSelection(entry.project) : folderSelection(entry.path)
