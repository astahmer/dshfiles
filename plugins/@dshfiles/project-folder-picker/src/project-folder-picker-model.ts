import type { ProjectFolderSelection, RegisteredProject } from './project-folder-picker.js'

export type PickerDirection = 'up' | 'down'
export type PickerEntry = { readonly kind: 'project'; readonly project: RegisteredProject } | { readonly kind: 'recent'; readonly path: string }
export type PickerTab = 'projects' | 'recents'

type DirectoryPathListing = {
  readonly path: string
  readonly home: string
  readonly entries: readonly { readonly name: string; readonly path: string }[]
  readonly truncated: boolean
}

const normalizeDirectoryPath = (path: string): string => path.replace(/\/+$/, '') || '/'

export class ProjectFolderPickerModel {
  static readonly isHomeRelativePathQuery = (query: string): boolean => {
    const path = query.trim()
    return path === '~' || path.startsWith('~/')
  }

  static readonly isPathQuery = (query: string): boolean => query.trim().startsWith('/') || ProjectFolderPickerModel.isHomeRelativePathQuery(query)

  static readonly resolvePathQuery = (query: string, home: string | undefined): string | null => {
    const path = query.trim()
    if (path.startsWith('/')) return normalizeDirectoryPath(path)
    if (!ProjectFolderPickerModel.isHomeRelativePathQuery(path) || home === undefined) return null
    const relativePath = (path === '~' ? '' : path.slice(2)).replace(/^\/+|\/+$/g, '')
    if (relativePath.length === 0) return home
    return `${home.replace(/\/+$/, '')}/${relativePath}`
  }

  static readonly matchingDirectoryPaths = (listing: DirectoryPathListing, query: string): readonly string[] | null => {
    const requestedPath = ProjectFolderPickerModel.resolvePathQuery(query, listing.home)
    if (requestedPath === null) return null
    const currentPath = normalizeDirectoryPath(listing.path)
    const normalizedRequestedPath = normalizeDirectoryPath(requestedPath)
    if (currentPath === normalizedRequestedPath) return null
    const prefix = currentPath === '/' ? '/' : `${currentPath}/`
    if (!normalizedRequestedPath.startsWith(prefix)) return null
    const remainingPath = normalizedRequestedPath.slice(prefix.length)
    const nextSegment = remainingPath.split('/')[0]
    if (nextSegment === undefined || nextSegment.length === 0) return null
    const segmentIsComplete = remainingPath.includes('/') || query.trim().endsWith('/')
    return listing.entries.filter(entry => (segmentIsComplete ? entry.name === nextSegment : entry.name.startsWith(nextSegment))).map(entry => entry.path)
  }

  static readonly uniqueMatchingDirectoryPath = (listing: DirectoryPathListing, query: string): string | null => {
    if (listing.truncated) return null
    const matchingPaths = ProjectFolderPickerModel.matchingDirectoryPaths(listing, query)
    return matchingPaths?.length === 1 ? (matchingPaths[0] ?? null) : null
  }

  static readonly isPathAtOrWithin = (path: string, parentPath: string): boolean => {
    const normalizedPath = normalizeDirectoryPath(path)
    const normalizedParentPath = normalizeDirectoryPath(parentPath)
    if (normalizedPath === normalizedParentPath) return true
    const prefix = normalizedParentPath === '/' ? '/' : `${normalizedParentPath}/`
    return normalizedPath.startsWith(prefix)
  }

  static readonly initialBrowseTarget = (mode: 'projects' | 'directories' | undefined): { readonly path: undefined } | null =>
    mode === 'directories' ? { path: undefined } : null

  static readonly filterRegisteredProjects = (projects: readonly RegisteredProject[], query: string): readonly RegisteredProject[] => {
    if (ProjectFolderPickerModel.isPathQuery(query)) return []
    const search = query.trim().toLocaleLowerCase()
    if (search.length === 0) return projects
    return projects.filter(project => `${project.title} ${project.canonicalPath}`.toLocaleLowerCase().includes(search))
  }

  static readonly movePickerSelection = (current: number, count: number, direction: PickerDirection): number => {
    if (count < 1) return 0
    const delta = direction === 'down' ? 1 : -1
    return (current + delta + count) % count
  }

  static readonly workspaceSelection = (project: RegisteredProject): ProjectFolderSelection => ({
    kind: 'workspace',
    workspaceId: project.workspaceId,
    canonicalPath: project.canonicalPath,
    title: project.title,
  })

  static readonly folderSelection = (canonicalPath: string): ProjectFolderSelection => ({
    kind: 'directory',
    canonicalPath,
    title: canonicalPath.split('/').filter(Boolean).at(-1) ?? canonicalPath,
  })

  /** Matching projects on the Projects tab; matching recent folders that are not registered projects on the Recents tab. */
  static readonly pickerEntries = (input: {
    readonly projects: readonly RegisteredProject[]
    readonly recentFolders: readonly string[]
    readonly query: string
    readonly tab: PickerTab
    readonly excludeJjWorkspaces: boolean
  }): readonly PickerEntry[] => {
    if (ProjectFolderPickerModel.isPathQuery(input.query)) return []
    if (input.tab === 'projects') {
      const visibleProjects = input.excludeJjWorkspaces ? input.projects.filter(project => project.isJjWorkspace !== true) : input.projects
      return ProjectFolderPickerModel.filterRegisteredProjects(visibleProjects, input.query).map((project): PickerEntry => ({ kind: 'project', project }))
    }
    const search = input.query.trim().toLocaleLowerCase()
    const projectPaths = new Set(input.projects.map(project => project.canonicalPath))
    return [...new Set(input.recentFolders)]
      .filter(path => !projectPaths.has(path) && path.toLocaleLowerCase().includes(search))
      .map((path): PickerEntry => ({ kind: 'recent', path }))
  }

  static readonly pickerEntrySelection = (entry: PickerEntry): ProjectFolderSelection =>
    entry.kind === 'project' ? ProjectFolderPickerModel.workspaceSelection(entry.project) : ProjectFolderPickerModel.folderSelection(entry.path)
}
