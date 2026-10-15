import type { ProjectFolderSelection, RegisteredProject } from './project-folder-picker.js'

export type PickerDirection = 'up' | 'down'

export const isHomeRelativePathQuery = (query: string): boolean => {
  const path = query.trim()
  return path === '~' || path.startsWith('~/')
}

export const isPathQuery = (query: string): boolean => query.trim().startsWith('/') || isHomeRelativePathQuery(query)

export const resolvePathQuery = (query: string, home: string | undefined): string | null => {
  const path = query.trim()
  if (path.startsWith('/')) return path
  if (!isHomeRelativePathQuery(path) || home === undefined) return null
  const relativePath = (path === '~' ? '' : path.slice(2)).replace(/^\/+|\/+$/g, '')
  if (relativePath.length === 0) return home
  return `${home.replace(/\/+$/, '')}/${relativePath}`
}

export const initialBrowseTarget = (mode: 'projects' | 'directories' | undefined): { readonly path: undefined } | null =>
  mode === 'directories' ? { path: undefined } : null

export const filterRegisteredProjects = (projects: readonly RegisteredProject[], query: string): readonly RegisteredProject[] => {
  if (isPathQuery(query)) return []
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
  if (isPathQuery(query)) return []
  const search = query.trim().toLocaleLowerCase()
  const projectPaths = new Set(projects.map(project => project.canonicalPath))
  const recent = [...new Set(recentFolders)].filter(path => !projectPaths.has(path) && path.toLocaleLowerCase().includes(search))
  return [...matchingProjects.map((project): PickerEntry => ({ kind: 'project', project })), ...recent.map((path): PickerEntry => ({ kind: 'recent', path }))]
}

export const pickerEntrySelection = (entry: PickerEntry): ProjectFolderSelection =>
  entry.kind === 'project' ? workspaceSelection(entry.project) : folderSelection(entry.path)
