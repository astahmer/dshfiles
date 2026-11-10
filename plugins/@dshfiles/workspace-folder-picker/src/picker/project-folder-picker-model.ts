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

/** How the Host spells paths: drive, UNC and `~\` syntax names a folder only on a Windows Host, and is search text elsewhere. */
export type PathStyle = 'posix' | 'windows'

const isWindowsPath = (path: string, style: PathStyle): boolean =>
  style === 'windows' && (/^[a-z]:[\\/]/i.test(path) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(path))
const normalizeDirectoryPath = (path: string, style: PathStyle): string => {
  if (!isWindowsPath(path, style)) return path.replace(/\/+$/, '') || '/'
  const separator = path.includes('\\') ? '\\' : '/'
  const slashes = path.replace(/\\/g, '/')
  const normalized = `${slashes.startsWith('//') ? '/' : ''}${slashes.replace(/\/+/g, '/').replace(/\/+$/, '')}`.replace(/\//g, separator)
  // A drive without its separator is drive-relative, so keep its root intact.
  return /^[a-z]:$/i.test(normalized) ? `${normalized}${separator}` : normalized
}
const comparisonPath = (path: string, style: PathStyle): string => {
  const normalized = normalizeDirectoryPath(path, style)
  return isWindowsPath(normalized, style) ? normalized.replace(/\\/g, '/').toLowerCase() : normalized
}
const childPrefix = (path: string): string => (path.endsWith('/') ? path : `${path}/`)

export class ProjectFolderPickerModel {
  /** The style of a path the Host produced; a Windows Host reports drive or UNC paths, never a bare `/`. */
  static readonly pathStyleOf = (hostPath: string): PathStyle => (/^[a-z]:[\\/]/i.test(hostPath) || hostPath.startsWith('\\\\') ? 'windows' : 'posix')

  static readonly isHomeRelativePathQuery = (query: string, style: PathStyle = 'posix'): boolean => {
    const path = query.trim()
    return path === '~' || path.startsWith('~/') || (style === 'windows' && path.startsWith('~\\'))
  }

  static readonly isAbsolutePath = (query: string, style: PathStyle = 'posix'): boolean => {
    const path = query.trim()
    if (style === 'posix') return path.startsWith('/')
    if (/^[\\/]{2}[?.][\\/]/.test(path)) return false
    return path.startsWith('/') || isWindowsPath(path, style)
  }

  static readonly isPathQuery = (query: string, style: PathStyle = 'posix'): boolean =>
    ProjectFolderPickerModel.isAbsolutePath(query, style) || ProjectFolderPickerModel.isHomeRelativePathQuery(query, style)

  static readonly resolvePathQuery = (
    query: string,
    home: string | undefined,
    style: PathStyle = home === undefined ? 'posix' : ProjectFolderPickerModel.pathStyleOf(home),
  ): string | null => {
    const path = query.trim()
    if (ProjectFolderPickerModel.isAbsolutePath(path, style)) return normalizeDirectoryPath(path, style)
    if (!ProjectFolderPickerModel.isHomeRelativePathQuery(path, style) || home === undefined) return null
    const windowsHome = isWindowsPath(home, style)
    const separator = windowsHome && home.includes('\\') ? '\\' : '/'
    const relativePath = (path === '~' ? '' : path.slice(2)).replace(windowsHome ? /^[\\/]+|[\\/]+$/g : /^\/+|\/+$/g, '')
    if (relativePath.length === 0) return normalizeDirectoryPath(home, style)
    const normalizedHome = normalizeDirectoryPath(home, style)
    return normalizeDirectoryPath(`${normalizedHome}${normalizedHome.endsWith(separator) ? '' : separator}${relativePath}`, style)
  }

  static readonly matchingDirectoryPaths = (listing: DirectoryPathListing, query: string): readonly string[] | null => {
    const style = ProjectFolderPickerModel.pathStyleOf(listing.home)
    const requestedPath = ProjectFolderPickerModel.resolvePathQuery(query, listing.home, style)
    if (requestedPath === null) return null
    const currentPath = comparisonPath(listing.path, style)
    const normalizedRequestedPath = comparisonPath(requestedPath, style)
    if (currentPath === normalizedRequestedPath) return null
    const prefix = childPrefix(currentPath)
    if (!normalizedRequestedPath.startsWith(prefix)) return null
    const remainingPath = normalizedRequestedPath.slice(prefix.length)
    const nextSegment = remainingPath.split('/')[0]
    if (nextSegment === undefined || nextSegment.length === 0) return null
    const windowsPath = isWindowsPath(requestedPath, style)
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
    const style = ProjectFolderPickerModel.pathStyleOf(parentPath)
    const normalizedPath = comparisonPath(path, style)
    const normalizedParentPath = comparisonPath(parentPath, style)
    if (normalizedPath === normalizedParentPath) return true
    const prefix = childPrefix(normalizedParentPath)
    return normalizedPath.startsWith(prefix)
  }

  static readonly initialBrowseTarget = (mode: 'projects' | 'directories' | undefined): { readonly path: undefined } | null =>
    mode === 'directories' ? { path: undefined } : null

  static readonly filterRegisteredProjects = (
    projects: readonly RegisteredProject[],
    query: string,
    style: PathStyle = 'posix',
  ): readonly RegisteredProject[] => {
    if (ProjectFolderPickerModel.isPathQuery(query, style)) return []
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
        .split(ProjectFolderPickerModel.pathStyleOf(canonicalPath) === 'windows' ? /[\\/]/ : '/')
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
    readonly pathStyle?: PathStyle
  }): readonly PickerSection[] => {
    if (ProjectFolderPickerModel.isPathQuery(input.query, input.pathStyle)) return []
    const pinnedIds = new Set(input.pinnedWorkspaceIds ?? [])
    const matching = ProjectFolderPickerModel.filterRegisteredProjects(input.projects, input.query, input.pathStyle)
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
