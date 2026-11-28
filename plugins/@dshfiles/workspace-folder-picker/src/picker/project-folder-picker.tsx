import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, HistoryIcon, PlusIcon, SearchIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { keepPreviousData, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ProjectTone, type ProjectColorEntry } from '../project-tone.js'
import { initialPickerFlow, pickerFlowReducer } from './picker-flow.js'
import { ProjectFolderPickerModel, type PathStyle, type PickerEntry, type PickerSectionId, type PickerTab } from './project-folder-picker-model.js'

export interface RegisteredProject {
  readonly workspaceId: string
  readonly title: string
  readonly canonicalPath: string
  readonly isJjWorkspace?: boolean
  readonly removable?: boolean
  /**
   * `folder`: an entry that is not a project folder (the Host's No folder) draws a neutral folder mark instead of the
   * project's coloured letters (council round 35 P3).
   */
  readonly mark?: 'folder'
}

export interface DirectoryListing {
  readonly path: string
  readonly home: string
  readonly crumbs: readonly { readonly name: string; readonly path: string; readonly hidden: boolean }[]
  readonly entries: readonly { readonly name: string; readonly path: string; readonly hidden: boolean }[]
  readonly truncated: boolean
}

export interface DirectoryPickerPort {
  readonly pick: (signal: AbortSignal) => Promise<string | null>
  readonly list: (path: string | undefined, signal: AbortSignal) => Promise<DirectoryListing>
  readonly createDirectory: (path: string, name: string) => Promise<string>
}

export type ProjectFolderSelection =
  | { readonly kind: 'workspace'; readonly workspaceId: string; readonly canonicalPath: string; readonly title: string }
  | { readonly kind: 'directory'; readonly canonicalPath: string; readonly title: string }

export interface ProjectFolderPickerProps {
  readonly projects: readonly RegisteredProject[]
  readonly directoryPicker: DirectoryPickerPort
  readonly onRegisterWorkspace: (absolutePath: string) => Promise<RegisteredProject>
  readonly onRemoveProject?: (project: RegisteredProject) => Promise<void>
  /** Receives an absolute path before Host canonicalization; the caller must validate it before use. */
  readonly onUseAbsolutePath?: (absolutePath: string) => void
  /** Shows the folder's setup step instead of registering it: what it is, plus Enable Jujutsu or Initialize. */
  readonly onInspectFolder?: (absolutePath: string) => void
  readonly onSelect: (selection: ProjectFolderSelection) => void
  readonly onClose: () => void
  readonly mode?: 'projects' | 'directories'
  readonly showNativePicker?: boolean
  /** How the Host spells paths, when the caller knows it; otherwise the listed home folder decides, and POSIX before any listing. */
  readonly pathStyle?: PathStyle | undefined
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly heading?: string
  /**
   * Identity of the machine these paths live on, shown with each row the way the
   * reference does. The picker is host-agnostic, so this is supplied by the
   * caller that knows it rather than read here.
   */
  readonly machineName?: string
  /** Recently chosen folders, newest first, for the Recents scope; a registered one shows as its project, another yields a directory selection. */
  readonly recentFolders?: readonly string[]
  /** Scope shown on open; Projects by default, which leaves JJ thread workspaces in their own scope. */
  readonly initialTab?: PickerTab
  /** Projects listed first on Everything and Projects, ahead of recents, under no heading. */
  readonly pinnedWorkspaceIds?: readonly string[]
  /** Accessible list label and placeholder override for callers whose list is not only projects. */
  readonly placeholder?: string
  /**
   * Caller-owned ways to add a project, after the search field: buttons in a wide pane, one Add menu in a narrow one (a
   * phone sheet), so the header never runs past the sheet's edge.
   */
  readonly addActions?: readonly PickerAddAction[]
  /** The project colours chosen in Settings › Projects, so a row's mark matches the thread list's and the composer's. */
  readonly projectColors?: readonly ProjectColorEntry[] | undefined
}

/** One way to add a project, offered beside the search field. */
export interface PickerAddAction {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly disabled?: boolean | undefined
  readonly onSelect: () => void
}

// `min-w-0`: a row gives way to its remove button instead of scrolling the list sideways (council round 34 A1).
const optionClassName =
  'dshx:flex dshx:w-full dshx:min-w-0 dshx:cursor-pointer dshx:items-center dshx:gap-3 dshx:rounded-md dshx:px-2 dshx:py-1.5 dshx:text-left dshx:outline-none'

/** A list row: its option and its trailing control. The highlight fills the whole row, the control's column included. */
const rowClassName = (active: boolean): string =>
  cn('dshx:flex dshx:items-center dshx:gap-1 dshx:rounded-md', active && 'dshx:bg-accent dshx:text-accent-foreground')

const listClassName = 'dshx:flex dshx:max-h-[min(420px,55vh)] dshx:min-h-12 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:px-2 dshx:pb-2'

const emptyClassName = 'dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground'

const noRecentFolders: readonly string[] = []

const noPinnedWorkspaces: readonly string[] = []

const tabLabels = { all: 'Everything', projects: 'Projects', recents: 'Recents', workspaces: 'Workspaces' } satisfies Readonly<Record<PickerTab, string>>

const sectionLabels = { pinned: 'Pinned', recents: 'Recents', projects: 'Projects', workspaces: 'JJ workspaces' } satisfies Readonly<
  Record<PickerSectionId, string>
>

const emptyLabels = {
  all: 'No projects or folders match.',
  projects: 'No registered projects match.',
  recents: 'No recent folders match.',
  workspaces: 'No JJ workspaces match.',
} satisfies Readonly<Record<PickerTab, string>>

export const ProjectFolderPicker = (props: ProjectFolderPickerProps): JSX.Element => {
  const [flow, dispatchFlow] = useReducer(pickerFlowReducer, props.mode, initialPickerFlow)
  const query = flow.query
  const browseTarget = flow.browse
  // -1: nothing is highlighted, so the primary action is the folder already open until the operator picks a row.
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [newDirectoryName, setNewDirectoryName] = useState('')
  const [projectToRemove, setProjectToRemove] = useState<RegisteredProject | null>(null)
  const pickRequest = useRef<AbortController | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const listingQuery = useQuery({
    queryKey: ['project-folder-picker', 'list', browseTarget?.path ?? null],
    queryFn: ({ signal }) => props.directoryPicker.list(browseTarget?.path, signal),
    enabled: browseTarget !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const pathStyle = props.pathStyle ?? (listingQuery.data === undefined ? 'posix' : ProjectFolderPickerModel.pathStyleOf(listingQuery.data.home))
  const pathMode = props.mode === 'directories' || ProjectFolderPickerModel.isPathQuery(query, pathStyle)
  const [tab, setTab] = useState<PickerTab>(props.initialTab ?? 'projects')
  const recentFolders = props.recentFolders ?? noRecentFolders
  const pinnedWorkspaceIds = props.pinnedWorkspaceIds ?? noPinnedWorkspaces
  const sections = useMemo(
    () => ProjectFolderPickerModel.pickerSections({ projects: props.projects, recentFolders, pinnedWorkspaceIds, query, tab, pathStyle }),
    [props.projects, recentFolders, pinnedWorkspaceIds, query, tab, pathStyle],
  )
  const entries = useMemo(() => sections.flatMap(section => section.entries), [sections])
  const entryIndices = useMemo(() => new Map(entries.map((entry, index) => [entry, index])), [entries])
  const tabs = useMemo(
    () => ProjectFolderPickerModel.availableTabs({ projects: props.projects, recentFolders, pinnedWorkspaceIds }),
    [props.projects, recentFolders, pinnedWorkspaceIds],
  )

  const listing = browseTarget === null ? null : (listingQuery.data ?? null)
  const parentPath = listing === null ? null : ProjectFolderPickerModel.parentDirectoryPath(listing)
  const absolutePath = query.trim()
  const hasAbsolutePath = ProjectFolderPickerModel.isAbsolutePath(absolutePath, pathStyle)
  const requestedPath = listing === null ? null : ProjectFolderPickerModel.resolvePathQuery(query, listing.home, pathStyle)
  const canUseTypedPath =
    pathMode && hasAbsolutePath && listing?.path !== absolutePath && (props.mode !== 'directories' || props.onUseAbsolutePath !== undefined)
  const showListingActions = listing !== null && (!ProjectFolderPickerModel.isPathQuery(query, pathStyle) || requestedPath === listing.path)
  const matchingFolderPaths = listing === null ? null : ProjectFolderPickerModel.matchingDirectoryPaths(listing, query)
  const matchingFolderPathSet = matchingFolderPaths === null ? null : new Set(matchingFolderPaths)
  const folderEntries = pathMode ? (listing?.entries.filter(entry => matchingFolderPathSet === null || matchingFolderPathSet.has(entry.path)) ?? []) : []
  const itemCount = pathMode ? folderEntries.length : entries.length
  const pickMutation = useMutation({
    mutationFn: () => {
      pickRequest.current?.abort()
      pickRequest.current = new AbortController()
      return props.directoryPicker.pick(pickRequest.current.signal)
    },
  })
  const registerMutation = useMutation({ mutationFn: (path: string) => props.onRegisterWorkspace(path) })
  const removeMutation = useMutation({
    mutationFn: async (project: RegisteredProject) => {
      if (props.onRemoveProject === undefined) return
      await props.onRemoveProject(project)
    },
  })
  const createMutation = useMutation({
    mutationFn: (variables: { readonly parent: string; readonly name: string }) => props.directoryPicker.createDirectory(variables.parent, variables.name),
  })
  const busy =
    props.disabled === true ||
    listingQuery.isFetching ||
    pickMutation.isPending ||
    registerMutation.isPending ||
    createMutation.isPending ||
    removeMutation.isPending
  let error: string | null = null
  if (pickMutation.isError) error = 'The native folder picker is unavailable. Paste an absolute path instead.'
  else if (registerMutation.isError) error = 'This folder could not be registered. Check that the absolute path exists and is accessible, then retry.'
  else if (createMutation.isError) error = 'This folder could not be created.'
  else if (removeMutation.isError) error = 'This project could not be removed from the registered projects.'
  else if (listingQuery.isError) error = canUseTypedPath ? 'Folder browsing failed. You can still use this absolute path.' : 'This folder could not be opened.'

  useEffect(() => () => pickRequest.current?.abort(), [])

  useEffect(() => setSelectedIndex(-1), [query, listing?.path, tab])

  useEffect(() => {
    if (listingQuery.data === undefined || listingQuery.isPlaceholderData || browseTarget === null) return
    dispatchFlow({ type: 'listing.loaded', listing: listingQuery.data, pathStyle, directories: props.mode === 'directories' })
  }, [browseTarget, listingQuery.data, listingQuery.isPlaceholderData, pathStyle, props.mode])

  const browse = (path: string | undefined): void => {
    pickMutation.reset()
    registerMutation.reset()
    createMutation.reset()
    dispatchFlow({ type: 'browse.requested', path })
  }

  const chooseWithSystemPicker = (): void => {
    registerMutation.reset()
    createMutation.reset()
    pickMutation.mutate(undefined, {
      onSuccess: pickedPath => {
        if (pickedPath === null) return
        if (props.mode === 'directories') props.onSelect(ProjectFolderPickerModel.folderSelection(pickedPath))
        else registerWorkspacePath(pickedPath)
      },
    })
  }

  const registerWorkspacePath = (path: string): void => {
    if (props.onInspectFolder !== undefined) {
      props.onInspectFolder(path)
      return
    }
    registerMutation.mutate(path, {
      onSuccess: project => props.onSelect(ProjectFolderPickerModel.workspaceSelection(project)),
    })
  }

  const registerCurrentFolder = (): void => {
    if (listing === null) return
    registerWorkspacePath(listing.path)
  }

  const useTypedPath = (): void => {
    if (!canUseTypedPath) return
    if (props.mode === 'directories') {
      props.onUseAbsolutePath?.(absolutePath)
      return
    }
    registerWorkspacePath(absolutePath)
  }

  const createFolder = (): void => {
    if (listing === null || newDirectoryName.trim().length === 0) return
    createMutation.mutate(
      { parent: listing.path, name: newDirectoryName.trim() },
      {
        onSuccess: createdPath => {
          setNewDirectoryName('')
          browse(createdPath)
        },
      },
    )
  }

  const selectVisibleItem = (): void => {
    if (pathMode) {
      const entry = folderEntries[selectedIndex]
      if (entry !== undefined) browse(entry.path)
      return
    }
    const entry = entries[selectedIndex]
    if (entry !== undefined) props.onSelect(ProjectFolderPickerModel.pickerEntrySelection(entry))
  }

  /** The folder the primary action adds: the highlighted row, else the folder already open. */
  const highlightedFolder = listing === null ? null : (folderEntries[selectedIndex] ?? null)
  const addTargetPath = highlightedFolder?.path ?? listing?.path ?? null
  const addTargetName = highlightedFolder?.name ?? listing?.crumbs.at(-1)?.name ?? addTargetPath?.split(/[\\/]/u).filter(Boolean).at(-1) ?? null
  const addTarget = (): void => {
    if (addTargetPath === null) return
    props.onSelect(ProjectFolderPickerModel.folderSelection(addTargetPath))
  }

  const openSelectedFolder = (): void => {
    if (!pathMode) return
    const entry = folderEntries[selectedIndex]
    if (entry !== undefined) browse(entry.path)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key) && !pathMode) {
      const entry = entries[Number(event.key) - 1]
      if (entry !== undefined) {
        event.preventDefault()
        props.onSelect(ProjectFolderPickerModel.pickerEntrySelection(entry))
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (itemCount === 0) return
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 'down' : 'up'
      setSelectedIndex(index => ProjectFolderPickerModel.movePickerSelection(index, itemCount, direction))
      return
    }
    if (event.key === 'ArrowRight' && pathMode) {
      if (itemCount === 0) return
      event.preventDefault()
      openSelectedFolder()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const pathQuery = query.trim()
      if (pathMode && pathQuery.length > 0) {
        const matchingPaths = listing === null ? null : ProjectFolderPickerModel.matchingDirectoryPaths(listing, pathQuery)
        const entry = folderEntries[selectedIndex]
        // A typed path adds the folder it names; browsing into it is the explicit →/double-click gesture.
        if (matchingPaths !== null && matchingPaths.length > 0) {
          if (entry !== undefined) addTarget()
          return
        }
        const requestedPath = ProjectFolderPickerModel.resolvePathQuery(pathQuery, listing?.home, pathStyle)
        if (ProjectFolderPickerModel.isHomeRelativePathQuery(pathQuery, pathStyle) && requestedPath === null) return
        const path = requestedPath ?? pathQuery
        if (listing?.path !== path) {
          props.onSelect(ProjectFolderPickerModel.folderSelection(path))
          return
        }
      }
      if (pathMode) addTarget()
      else selectVisibleItem()
    }
  }

  const title = props.heading ?? (props.mode === 'directories' ? 'Choose a folder' : 'Choose a project or folder')
  const addActions = props.addActions ?? []
  // Browsing a folder, the breadcrumb row has room at its end: a narrow sheet's Add sits there, not alone on a line.
  const crumbsHoldAdd = pathMode && listing !== null && addActions.length > 0

  return (
    <>
      <Dialog
        onOpenChange={(open: boolean) => {
          if (!open) props.onClose()
        }}
        open
      >
        <DialogContent
          // One shrinkable column (council round 34 A1): a long path or a row of buttons never widens the sheet past the
          // screen, and the sheet is the container its header and rows query.
          className="dshx-root dshx:@container dshx:grid-cols-[minmax(0,1fr)] dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-2xl"
          onOpenAutoFocus={(event: { preventDefault: () => void }) => {
            event.preventDefault()
            searchInput.current?.focus()
          }}
          showCloseButton={false}
        >
          <DialogTitle className="dshx:sr-only">{title}</DialogTitle>
          <DialogDescription className="dshx:sr-only">
            {props.mode === 'directories'
              ? 'Browse folders, or type a path to open a unique folder match automatically.'
              : 'Search registered projects, or type an absolute or ~/ path to browse folders. A unique match opens automatically.'}
          </DialogDescription>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:p-2" data-picker-header="">
            <div className="dshx:relative dshx:min-w-0 dshx:flex-1 dshx:@max-pane-narrow:basis-full">
              <SearchIcon
                aria-hidden
                className="dshx:pointer-events-none dshx:absolute dshx:top-1/2 dshx:left-2.5 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground"
              />
              <Input
                aria-label={props.mode === 'directories' ? 'Enter a folder path' : 'Search projects or enter a folder path'}
                autoComplete="off"
                className="dshx:h-9 dshx:pl-8 dshx:text-ellipsis dshx:pointer-coarse:h-11"
                onChange={event => {
                  dispatchFlow({
                    type: 'query.typed',
                    query: event.currentTarget.value,
                    listing,
                    pathStyle,
                    directories: props.mode === 'directories',
                  })
                  pickMutation.reset()
                  registerMutation.reset()
                  createMutation.reset()
                }}
                onKeyDown={onKeyDown}
                placeholder={props.placeholder ?? (props.mode === 'directories' ? 'Type a folder path…' : 'Search projects or type a path…')}
                ref={searchInput}
                value={query}
              />
            </div>
            {!pathMode && tabs.length > 2 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label="Filter by scope" className="dshx:shrink-0 dshx:pointer-coarse:h-11" size="sm" type="button" variant="outline">
                    {tabLabels[tab]}
                    <ChevronDownIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="dshx-root">
                  <DropdownMenuRadioGroup
                    onValueChange={(value: string) => {
                      if (ProjectFolderPickerModel.isPickerTab(value)) setTab(value)
                    }}
                    value={tab}
                  >
                    {tabs.map(pickerTab => (
                      <DropdownMenuRadioItem key={pickerTab} value={pickerTab}>
                        {tabLabels[pickerTab]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {props.showNativePicker !== false && (
              <Button disabled={busy} onClick={() => chooseWithSystemPicker()} type="button" variant="outline">
                <FolderOpenIcon aria-hidden />
                Browse…
              </Button>
            )}
            {addActions.length === 0 ? null : (
              <>
                <PickerAddButtons actions={addActions} />
                {/* While browsing, a narrow sheet's Add ends the breadcrumb row instead (council round 35 P3). */}
                {crumbsHoldAdd ? null : <PickerAddMenu actions={addActions} />}
              </>
            )}
          </div>
          {pathMode ? (
            <>
              {listing !== null && (
                <div className="dshx:flex dshx:items-center dshx:gap-1 dshx:border-b dshx:pr-2">
                  <div
                    aria-label="Folder path"
                    className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-0.5 dshx:overflow-x-auto dshx:px-2 dshx:py-1.5"
                    role="navigation"
                  >
                    <Button
                      aria-label="Up one folder"
                      className="dshx:size-7 dshx:shrink-0 dshx:p-0"
                      disabled={parentPath === null}
                      onClick={() => browse(parentPath ?? undefined)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowUpIcon aria-hidden className="dshx:size-4" />
                    </Button>
                    <TooltipProvider>
                      {ProjectFolderPickerModel.visibleCrumbs(listing.crumbs).map((crumb, index, crumbs) => (
                        <span className="dshx:flex dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:gap-0.5" key={crumb.path}>
                          {index > 0 && <ChevronRightIcon aria-hidden className="dshx:size-3 dshx:shrink-0 dshx:text-muted-foreground" />}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                                className={cn(
                                  'dshx:max-w-40 dshx:truncate dshx:rounded-sm dshx:px-1.5 dshx:py-1 dshx:text-xs dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                                  index === crumbs.length - 1 ? 'dshx:font-medium dshx:text-foreground' : 'dshx:text-muted-foreground',
                                )}
                                onClick={() => browse(crumb.path)}
                                type="button"
                              >
                                {crumb.name}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{crumb.path}</TooltipContent>
                          </Tooltip>
                        </span>
                      ))}
                    </TooltipProvider>
                  </div>
                  {crumbsHoldAdd ? <PickerAddMenu actions={addActions} /> : null}
                </div>
              )}
              <div aria-busy={listingQuery.isFetching} aria-label="Folders" className={cn(listClassName, listing === null && 'dshx:pt-2')} role="listbox">
                {folderEntries.map((entry, index) => (
                  <div className={rowClassName(index === selectedIndex)} key={entry.path} role="none">
                    <button
                      aria-selected={index === selectedIndex}
                      className={cn(optionClassName, 'dshx:flex-1')}
                      onClick={() => setSelectedIndex(index)}
                      onDoubleClick={() => browse(entry.path)}
                      role="option"
                      type="button"
                    >
                      <FolderIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
                      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                        <span className="dshx:truncate dshx:text-sm">{entry.name}</span>
                        {/* A folder in the open folder needs no path: the breadcrumbs say it (council round 35 P3). */}
                        {ProjectFolderPickerModel.isDirectChild(entry.path, listing?.path) ? null : (
                          <span className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{entry.path}</span>
                        )}
                      </span>
                      {entry.hidden && <Badge variant="muted">Hidden</Badge>}
                    </button>
                    <Button
                      aria-label={`Open ${entry.name}`}
                      className="dshx:mr-1 dshx:size-7 dshx:shrink-0 dshx:p-0"
                      onClick={() => browse(entry.path)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <ChevronRightIcon aria-hidden className="dshx:size-4 dshx:text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                {listing === null && <p className={emptyClassName}>Type an absolute or ~/ folder path to browse.</p>}
                {listing !== null && folderEntries.length === 0 && (
                  <p className={emptyClassName}>{matchingFolderPaths === null ? 'No folders here.' : 'No matching folders in this listing.'}</p>
                )}
              </div>
              {canUseTypedPath && (
                <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:p-2">
                  <Button
                    disabled={props.disabled === true || pickMutation.isPending || registerMutation.isPending || createMutation.isPending}
                    onClick={() => useTypedPath()}
                    size="sm"
                    type="button"
                    variant={props.mode === 'directories' ? 'default' : 'outline'}
                  >
                    {props.mode === 'directories' ? 'Use this path' : 'Register project'}
                  </Button>
                </div>
              )}
              {showListingActions && (
                <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:p-2">
                  <Button disabled={busy || addTargetPath === null} onClick={() => addTarget()} size="sm" type="button">
                    {props.mode === 'directories' ? `Add ${addTargetName === null ? 'this folder' : `“${addTargetName}”`}` : 'Register project'}
                  </Button>
                  {props.mode !== 'directories' && (
                    <Button disabled={busy} onClick={() => registerCurrentFolder()} size="sm" type="button" variant="outline">
                      Register this folder
                    </Button>
                  )}
                  <form
                    className="dshx:flex dshx:min-w-60 dshx:flex-1 dshx:items-center dshx:gap-2"
                    onSubmit={event => {
                      event.preventDefault()
                      createFolder()
                    }}
                  >
                    <Input
                      aria-label="New folder name"
                      className="dshx:h-7 dshx:flex-1"
                      onChange={event => setNewDirectoryName(event.currentTarget.value)}
                      placeholder="New folder name"
                      value={newDirectoryName}
                    />
                    <Button disabled={busy || newDirectoryName.trim().length === 0} size="sm" type="submit" variant="outline">
                      Create folder
                    </Button>
                  </form>
                  {listing.truncated && <Badge variant="warning">Folder list is truncated.</Badge>}
                </div>
              )}
            </>
          ) : (
            <>
              <div aria-busy={props.loading === true} aria-label={tabLabels[tab]} className={cn(listClassName, 'dshx:pt-2')} role="listbox">
                {sections.map(section => (
                  <div aria-label={tab === 'all' ? sectionLabels[section.id] : undefined} className="dshx:contents" key={section.id} role="group">
                    {tab === 'all' && sections.length > 1 && section.id !== 'pinned' && (
                      <p aria-hidden className="dshx:px-2 dshx:pt-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
                        {sectionLabels[section.id]}
                      </p>
                    )}
                    {section.entries.map(entry => {
                      const index = entryIndices.get(entry) ?? 0
                      return (
                        <PickerEntryRow
                          active={index === selectedIndex}
                          entry={entry}
                          index={index}
                          key={entry.kind === 'project' ? entry.project.workspaceId : 'recent:' + entry.path}
                          machineName={props.machineName}
                          color={entry.kind === 'project' ? ProjectTone.savedColorOf(entry.project.canonicalPath, props.projectColors) : undefined}
                          onHover={() => setSelectedIndex(index)}
                          onRemove={
                            props.onRemoveProject === undefined ||
                            entry.kind !== 'project' ||
                            entry.project.isJjWorkspace === true ||
                            entry.project.removable === false
                              ? undefined
                              : () => setProjectToRemove(entry.project)
                          }
                          onSelect={() => props.onSelect(ProjectFolderPickerModel.pickerEntrySelection(entry))}
                        />
                      )
                    })}
                  </div>
                ))}
                {entries.length === 0 && <p className={emptyClassName}>{props.loading === true ? 'Loading projects…' : emptyLabels[tab]}</p>}
              </div>
            </>
          )}
          {error !== null && (
            <div className="dshx:px-2 dshx:pb-2">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}
          {/* The keyboard legend is for a keyboard: a touch sheet has none (council round 34 A1). */}
          <footer
            className="dshx:flex dshx:items-center dshx:gap-4 dshx:border-t dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground dshx:pointer-coarse:hidden"
            data-picker-legend=""
          >
            <span className="dshx:flex dshx:items-center dshx:gap-1.5">
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              Choose
            </span>
            <span className="dshx:flex dshx:items-center dshx:gap-1.5">
              <Kbd>→</Kbd>
              Open folder
            </span>
            <span className="dshx:flex dshx:items-center dshx:gap-1.5">
              <Kbd>Enter</Kbd>
              Add / select
            </span>
            <span className="dshx:flex dshx:items-center dshx:gap-1.5">
              <Kbd>Esc</Kbd>
              Close
            </span>
          </footer>
        </DialogContent>
      </Dialog>
      <AlertDialog
        onOpenChange={(open: boolean) => {
          if (!open && !removeMutation.isPending) {
            setProjectToRemove(null)
            removeMutation.reset()
          }
        }}
        open={projectToRemove !== null}
      >
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {projectToRemove?.title} from known projects?</AlertDialogTitle>
            <AlertDialogDescription>The folder and its files stay on disk. Threads in this project lose their project grouping.</AlertDialogDescription>
            {removeMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>This project could not be removed. Try again.</AlertDescription>
              </Alert>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMutation.isPending || projectToRemove === null}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault()
                if (projectToRemove === null) return
                removeMutation.mutate(projectToRemove, {
                  onSuccess: () => setProjectToRemove(null),
                })
              }}
              variant="destructive"
            >
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * The caller's ways to add a project. A wide pane shows them as buttons; a narrow one (a phone sheet) folds them into
 * one Add menu on the scope's line, so the header keeps the sheet's width (council round 34 A1), or at the end of the
 * breadcrumb row while browsing (council round 35 P3).
 */
const PickerAddButtons = (props: { readonly actions: readonly PickerAddAction[] }): JSX.Element => (
  <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:@max-pane-narrow:hidden" data-picker-add="buttons">
    {props.actions.map(action => (
      <Button className="dshx:shrink-0" disabled={action.disabled === true} key={action.id} onClick={action.onSelect} size="sm" type="button" variant="outline">
        {action.icon}
        {action.label}
      </Button>
    ))}
  </div>
)

const PickerAddMenu = (props: { readonly actions: readonly PickerAddAction[] }): JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        aria-label="Add a project"
        className="dshx:hidden dshx:@max-pane-narrow:ml-auto dshx:@max-pane-narrow:inline-flex dshx:pointer-coarse:h-11"
        data-picker-add="menu"
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon aria-hidden />
        Add
        <ChevronDownIcon aria-hidden />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="dshx-root">
      {props.actions.map(action => (
        <DropdownMenuItem className="dshx:pointer-coarse:min-h-11" disabled={action.disabled === true} key={action.id} onSelect={action.onSelect}>
          {action.icon}
          {action.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

/**
 * A folder path that gives way in the middle (council round 34 A1): the parent folders truncate first, the folder's own
 * name stays whole as long as it fits the row, so `/private/var/fo…/web-app` still says which folder it is.
 */
const PickerPath = (props: { readonly path: string; readonly machineName: string | undefined }): JSX.Element => {
  const cut = Math.max(props.path.lastIndexOf('/'), props.path.lastIndexOf('\\'))
  const head = cut > 0 ? props.path.slice(0, cut) : ''
  const tail = cut > 0 ? props.path.slice(cut) : props.path
  return (
    <span className="dshx:flex dshx:min-w-0 dshx:text-xs dshx:text-muted-foreground" data-picker-path="">
      <span className="dshx:min-w-0 dshx:truncate">
        {props.machineName === undefined ? null : `${props.machineName} · `}
        <span className="dshx:font-mono">{head}</span>
      </span>
      <span className="dshx:max-w-full dshx:shrink-0 dshx:truncate dshx:font-mono" data-picker-path-tail="">
        {tail}
      </span>
    </span>
  )
}

interface PickerEntryRowProps {
  readonly entry: PickerEntry
  readonly index: number
  readonly active: boolean
  readonly machineName: string | undefined
  /** The project's chosen colour, when one was saved; otherwise its name picks the tone, as everywhere else. */
  readonly color: ReturnType<typeof ProjectTone.savedColorOf>
  readonly onHover: () => void
  readonly onSelect: () => void
  readonly onRemove: (() => void) | undefined
}

const PickerEntryRow = (props: PickerEntryRowProps): JSX.Element => {
  const title = props.entry.kind === 'project' ? props.entry.project.title : (props.entry.path.split('/').filter(Boolean).at(-1) ?? props.entry.path)
  const path = props.entry.kind === 'project' ? props.entry.project.canonicalPath : props.entry.path
  return (
    <div aria-label={title} className={rowClassName(props.active)} role="group">
      <button
        aria-selected={props.active}
        className={optionClassName}
        onClick={props.onSelect}
        onMouseEnter={props.onHover}
        role="option"
        type="button"
      >
        {props.entry.kind === 'project' && props.entry.project.mark === 'folder' ? (
          // Not a project folder (No folder): a neutral folder mark, not coloured letters (council round 35 P3).
          <span
            aria-hidden
            className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-muted dshx:text-muted-foreground"
            data-picker-folder-mark=""
          >
            <FolderIcon className="dshx:size-3.5" />
          </span>
        ) : props.entry.kind === 'project' ? (
          // The kit's project mark (council round 34 A1): the letters and colour the thread list, the tabs and the
          // composer's headline draw for this project, at the row's 28px seat.
          <ProjectMark
            className="dshx:h-7 dshx:min-w-7 dshx:rounded-md dshx:text-xs"
            color={props.color?.kind === 'custom' ? props.color.color : undefined}
            data-picker-project-mark={title}
            name={title}
            tone={props.color?.kind === 'tone' ? props.color.tone : undefined}
          />
        ) : (
          <span
            aria-hidden
            className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-muted dshx:text-muted-foreground"
          >
            <HistoryIcon className="dshx:size-3.5" />
          </span>
        )}
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{title}</span>
            {props.entry.kind === 'project' && props.entry.project.isJjWorkspace === true ? <Badge variant="muted">JJ workspace</Badge> : null}
          </span>
          <PickerPath machineName={props.machineName} path={path} />
        </span>
        {props.index < 9 && (
          <KbdGroup className="dshx:pointer-coarse:hidden">
            <Kbd>⌘</Kbd>
            <Kbd>{props.index + 1}</Kbd>
          </KbdGroup>
        )}
      </button>
      {props.onRemove !== undefined && (
        <Button
          aria-label={`Remove ${title} from known projects`}
          // Secondary ink at rest, a 14px glyph (council round 35 P3); the kit icon size keeps its 44pt touch area.
          className="dshx:size-8 dshx:shrink-0 dshx:px-0 dshx:text-muted-foreground"
          onClick={event => {
            event.stopPropagation()
            props.onRemove?.()
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <XIcon aria-hidden className="dshx:size-3.5" />
        </Button>
      )}
    </div>
  )
}
