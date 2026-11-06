import type { ProjectFolderSelection, RegisteredProject } from './project-folder-picker.js'

export type PickerDirection = 'up' | 'down'
export type PickerEntry = { readonly kind: 'project'; readonly project: RegisteredProject } | { readonly kind: 'recent'; readonly path: string }
export type PickerSectionId = 'pinned' | 'recents' | 'projects' | 'workspaces'
export type PickerTab = 'all' | Exclude<PickerSectionId, 'pinned'>
export interface PickerSection {
  readonly id: PickerSectionId
  readonly entries: readonly PickerEntry[]
}

const pickerTabs: readonly PickerTab[] = ['all', 'projects', 'recents', 'workspaces']

type DirectoryPathListing = {
  readonly path: string
  readonly home: string
  readonly entries: readonly { readonly name: string; readonly path: string }[]
  readonly truncated: boolean
}

const isWindowsPath = (path: string): boolean => /^[a-z]:[\\/]/i.test(path) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(path)
const normalizeDirectoryPath = (path: string): string => {
  if (!isWindowsPath(path)) return path.replace(/\/+$/, '') || '/'
  const separator = path.includes('\\') ? '\\' : '/'
  const slashes = path.replace(/\\/g, '/')
  const normalized = `${slashes.startsWith('//') ? '/' : ''}${slashes.replace(/\/+/g, '/').replace(/\/+$/, '')}`.replace(/\//g, separator)
  // A drive without its separator is drive-relative, so keep its root intact.
  return /^[a-z]:$/i.test(normalized) ? `${normalized}${separator}` : normalized
}
const comparisonPath = (path: string): string => {
  const normalized = normalizeDirectoryPath(path)
  return isWindowsPath(normalized) ? normalized.replace(/\\/g, '/').toLowerCase() : normalized
}
const childPrefix = (path: string): string => (path.endsWith('/') ? path : `${path}/`)

export class ProjectFolderPickerModel {
  static readonly isHomeRelativePathQuery = (query: string): boolean => {
    const path = query.trim()
    return path === '~' || /^~[\\/]/.test(path)
  }

  static readonly isAbsolutePath = (query: string): boolean => {
    const path = query.trim()
    if (/^[\\/]{2}[?.][\\/]/.test(path)) return false
    return path.startsWith('/') || isWindowsPath(path)
  }

  static readonly isPathQuery = (query: string): boolean =>
    ProjectFolderPickerModel.isAbsolutePath(query) || ProjectFolderPickerModel.isHomeRelativePathQuery(query)

  static readonly resolvePathQuery = (query: string, home: string | undefined): string | null => {
    const path = query.trim()
    if (ProjectFolderPickerModel.isAbsolutePath(path)) return normalizeDirectoryPath(path)
    if (!ProjectFolderPickerModel.isHomeRelativePathQuery(path) || home === undefined) return null
    const windowsHome = isWindowsPath(home)
    const separator = windowsHome && home.includes('\\') ? '\\' : '/'
    const relativePath = (path === '~' ? '' : path.slice(2)).replace(windowsHome ? /^[\\/]+|[\\/]+$/g : /^\/+|\/+$/g, '')
    if (relativePath.length === 0) return normalizeDirectoryPath(home)
    const normalizedHome = normalizeDirectoryPath(home)
    return normalizeDirectoryPath(`${normalizedHome}${normalizedHome.endsWith(separator) ? '' : separator}${relativePath}`)
  }

  static readonly matchingDirectoryPaths = (listing: DirectoryPathListing, query: string): readonly string[] | null => {
    const requestedPath = ProjectFolderPickerModel.resolvePathQuery(query, listing.home)
    if (requestedPath === null) return null
    const currentPath = comparisonPath(listing.path)
    const normalizedRequestedPath = comparisonPath(requestedPath)
    if (currentPath === normalizedRequestedPath) return null
    const prefix = childPrefix(currentPath)
    if (!normalizedRequestedPath.startsWith(prefix)) return null
    const remainingPath = normalizedRequestedPath.slice(prefix.length)
    const nextSegment = remainingPath.split('/')[0]
    if (nextSegment === undefined || nextSegment.length === 0) return null
    const windowsPath = isWindowsPath(requestedPath)
    const segmentIsComplete = remainingPath.includes('/') || (windowsPath ? /[\\/]$/.test(query.trim()) : query.trim().endsWith('/'))
    return listing.entries
      .filter(entry => {
        const name = windowsPath ? entry.name.toLowerCase() : entry.name
        return segmentIsComplete ? name === nextSegment : name.startsWith(nextSegment)
      })
      .map(entry => entry.path)
  }

  static readonly uniqueMatchingDirectoryPath = (listing: DirectoryPathListing, query: string): string | null => {
    if (listing.truncated) return null
    const matchingPaths = ProjectFolderPickerModel.matchingDirectoryPaths(listing, query)
    return matchingPaths?.length === 1 ? (matchingPaths[0] ?? null) : null
  }

  static readonly isPathAtOrWithin = (path: string, parentPath: string): boolean => {
    const normalizedPath = comparisonPath(path)
    const normalizedParentPath = comparisonPath(parentPath)
    if (normalizedPath === normalizedParentPath) return true
    const prefix = childPrefix(normalizedParentPath)
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
    title:
      canonicalPath
        .split(isWindowsPath(canonicalPath) ? /[\\/]/ : '/')
        .filter(Boolean)
        .at(-1) ?? canonicalPath,
  })

  static readonly isPickerTab = (value: string): value is PickerTab => pickerTabs.some(tab => tab === value)

  static readonly entryPath = (entry: PickerEntry): string => (entry.kind === 'project' ? entry.project.canonicalPath : entry.path)

  /**
   * The sections one scope lists. Pinned projects lead Everything and Projects. Projects exclude JJ thread workspaces,
   * which get their own scope. Recents keep the caller's order, show a registered folder as its project and never list a
   * JJ workspace. Everything lists pinned, recents, projects, then workspaces, each folder once; empty sections are dropped.
   */
  static readonly pickerSections = (input: {
    readonly projects: readonly RegisteredProject[]
    readonly recentFolders: readonly string[]
    readonly pinnedWorkspaceIds?: readonly string[]
    readonly query: string
    readonly tab: PickerTab
  }): readonly PickerSection[] => {
    if (ProjectFolderPickerModel.isPathQuery(input.query)) return []
    const pinnedIds = new Set(input.pinnedWorkspaceIds ?? [])
    const matching = ProjectFolderPickerModel.filterRegisteredProjects(input.projects, input.query)
    const projectByPath = new Map(input.projects.map(project => [project.canonicalPath, project]))
    const search = input.query.trim().toLocaleLowerCase()
    const recents = [...new Set(input.recentFolders)].flatMap((path): PickerEntry[] => {
      const project = projectByPath.get(path)
      if (project === undefined) return path.toLocaleLowerCase().includes(search) ? [{ kind: 'recent', path }] : []
      if (project.isJjWorkspace === true || pinnedIds.has(project.workspaceId)) return []
      return matching.includes(project) ? [{ kind: 'project', project }] : []
    })
    const shownInRecents = new Set(input.tab === 'all' ? recents.map(ProjectFolderPickerModel.entryPath) : [])
    const projectEntries = (workspaces: boolean): readonly PickerEntry[] =>
      matching
        .filter(project => (project.isJjWorkspace === true) === workspaces && !pinnedIds.has(project.workspaceId) && !shownInRecents.has(project.canonicalPath))
        .map((project): PickerEntry => ({ kind: 'project', project }))
    const pinned = matching.filter(project => pinnedIds.has(project.workspaceId)).map((project): PickerEntry => ({ kind: 'project', project }))
    const sections: readonly PickerSection[] = [
      { id: 'pinned', entries: input.tab === 'all' || input.tab === 'projects' ? pinned : [] },
      { id: 'recents', entries: input.tab === 'all' || input.tab === 'recents' ? recents : [] },
      { id: 'projects', entries: input.tab === 'all' || input.tab === 'projects' ? projectEntries(false) : [] },
      { id: 'workspaces', entries: input.tab === 'all' || input.tab === 'workspaces' ? projectEntries(true) : [] },
    ]
    return sections.filter(section => section.entries.length > 0)
  }

  /** Scopes worth offering: Everything and Projects always, Recents and Workspaces only when they have folders. */
  static readonly availableTabs = (input: {
    readonly projects: readonly RegisteredProject[]
    readonly recentFolders: readonly string[]
    readonly pinnedWorkspaceIds?: readonly string[]
  }): readonly PickerTab[] =>
    pickerTabs.filter(tab => {
      if (tab === 'recents') return ProjectFolderPickerModel.pickerSections({ ...input, query: '', tab: 'recents' }).length > 0
      if (tab === 'workspaces') return input.projects.some(project => project.isJjWorkspace === true)
      return true
    })

  static readonly pickerEntrySelection = (entry: PickerEntry): ProjectFolderSelection =>
    entry.kind === 'project' ? ProjectFolderPickerModel.workspaceSelection(entry.project) : ProjectFolderPickerModel.folderSelection(entry.path)
}
