import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { FolderIcon, FolderOpenIcon, HistoryIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { keepPreviousData, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ProjectFolderPickerModel, type PickerEntry, type PickerTab } from './project-folder-picker-model.js'

export interface RegisteredProject {
  readonly workspaceId: string
  readonly title: string
  readonly canonicalPath: string
  readonly isJjWorkspace?: boolean
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
  /** Receives an absolute path before Host canonicalization; the caller must validate it before use. */
  readonly onUseAbsolutePath?: (absolutePath: string) => void
  readonly onSelect: (selection: ProjectFolderSelection) => void
  readonly onClose: () => void
  readonly mode?: 'projects' | 'directories'
  readonly showNativePicker?: boolean
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly title?: string
  /**
   * Identity of the machine these paths live on, shown with each row the way the
   * reference does. The picker is host-agnostic, so this is supplied by the
   * caller that knows it rather than read here.
   */
  readonly machineName?: string
  /** Previously chosen folders offered on the Recents tab; selecting one yields a directory selection. */
  readonly recentFolders?: readonly string[]
  /** Initial state of the "Hide JJ workspaces" switch, which drops projects flagged `isJjWorkspace` from the Projects tab. */
  readonly excludeJjWorkspaces?: boolean
  /** Accessible list label and placeholder override for callers whose list is not only projects. */
  readonly placeholder?: string
}

const projectGlyphTones = [
  'dshx:bg-chart-1/15 dshx:text-chart-1',
  'dshx:bg-chart-2/15 dshx:text-chart-2',
  'dshx:bg-chart-3/15 dshx:text-chart-3',
  'dshx:bg-chart-4/15 dshx:text-chart-4',
  'dshx:bg-chart-5/15 dshx:text-chart-5',
]

const projectGlyphTone = (title: string): string => {
  let hash = 0
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return projectGlyphTones[hash % projectGlyphTones.length] ?? ''
}

const optionClassName = (active: boolean): string =>
  cn(
    'dshx:flex dshx:w-full dshx:cursor-pointer dshx:items-center dshx:gap-3 dshx:rounded-md dshx:px-2 dshx:py-1.5 dshx:text-left dshx:outline-none',
    active && 'dshx:bg-accent dshx:text-accent-foreground',
  )

const listClassName = 'dshx:flex dshx:max-h-[min(420px,55vh)] dshx:min-h-12 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:px-2 dshx:pb-2'

const emptyClassName = 'dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground'

export const ProjectFolderPicker = (props: ProjectFolderPickerProps): JSX.Element => {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [newDirectoryName, setNewDirectoryName] = useState('')
  const [browseTarget, setBrowseTarget] = useState<{ readonly path: string | undefined } | null>(() => ProjectFolderPickerModel.initialBrowseTarget(props.mode))
  const pickRequest = useRef<AbortController | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const pathMode = props.mode === 'directories' || ProjectFolderPickerModel.isPathQuery(query)
  const [tab, setTab] = useState<PickerTab>('projects')
  const [excludeJjWorkspaces, setExcludeJjWorkspaces] = useState(props.excludeJjWorkspaces === true)
  const recentFolders = props.recentFolders
  const entries = useMemo(
    () => ProjectFolderPickerModel.pickerEntries({ projects: props.projects, recentFolders: recentFolders ?? [], query, tab, excludeJjWorkspaces }),
    [props.projects, recentFolders, query, tab, excludeJjWorkspaces],
  )
  const hasRecentFolders = useMemo(
    () =>
      ProjectFolderPickerModel.pickerEntries({ projects: props.projects, recentFolders: recentFolders ?? [], query: '', tab: 'recents', excludeJjWorkspaces })
        .length > 0,
    [props.projects, recentFolders, excludeJjWorkspaces],
  )
  const hasJjWorkspaces = props.projects.some(project => project.isJjWorkspace === true)

  const listingQuery = useQuery({
    queryKey: ['project-folder-picker', 'list', browseTarget?.path ?? null],
    queryFn: ({ signal }) => props.directoryPicker.list(browseTarget?.path, signal),
    enabled: browseTarget !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const listing = browseTarget === null ? null : (listingQuery.data ?? null)
  const absolutePath = query.trim()
  const hasAbsolutePath = absolutePath.startsWith('/')
  const requestedPath = listing === null ? null : ProjectFolderPickerModel.resolvePathQuery(query, listing.home)
  const canUseTypedPath =
    pathMode && hasAbsolutePath && listing?.path !== absolutePath && (props.mode !== 'directories' || props.onUseAbsolutePath !== undefined)
  const showListingActions = listing !== null && (!ProjectFolderPickerModel.isPathQuery(query) || requestedPath === listing.path)
  const matchingFolderPaths = listing === null ? null : ProjectFolderPickerModel.matchingDirectoryPaths(listing, query)
  const folderEntries = pathMode ? (listing?.entries.filter(entry => matchingFolderPaths === null || matchingFolderPaths.includes(entry.path)) ?? []) : []
  const itemCount = pathMode ? folderEntries.length : entries.length
  const pickMutation = useMutation({
    mutationFn: () => {
      pickRequest.current?.abort()
      pickRequest.current = new AbortController()
      return props.directoryPicker.pick(pickRequest.current.signal)
    },
  })
  const registerMutation = useMutation({ mutationFn: (path: string) => props.onRegisterWorkspace(path) })
  const createMutation = useMutation({
    mutationFn: (variables: { readonly parent: string; readonly name: string }) => props.directoryPicker.createDirectory(variables.parent, variables.name),
  })
  const busy = props.disabled === true || listingQuery.isFetching || pickMutation.isPending || registerMutation.isPending || createMutation.isPending
  let error: string | null = null
  if (pickMutation.isError) error = 'The folder picker is unavailable on this Host.'
  else if (registerMutation.isError) error = 'This folder could not be registered as a project.'
  else if (createMutation.isError) error = 'This folder could not be created.'
  else if (listingQuery.isError) error = canUseTypedPath ? 'Folder browsing failed. You can still use this absolute path.' : 'This folder could not be opened.'

  useEffect(() => () => pickRequest.current?.abort(), [])

  useEffect(() => setSelectedIndex(0), [query, listing?.path, tab, excludeJjWorkspaces])

  useEffect(() => {
    if (listingQuery.data === undefined || listingQuery.isPlaceholderData || browseTarget === null) return
    const currentListing = listingQuery.data
    setQuery(currentQuery => {
      if (ProjectFolderPickerModel.matchingDirectoryPaths(currentListing, currentQuery) !== null) return currentQuery
      return browseTarget.path === undefined && ProjectFolderPickerModel.isPathQuery(currentQuery) ? currentQuery : currentListing.path
    })
  }, [listingQuery.data, listingQuery.isPlaceholderData, browseTarget])

  const browse = useCallback(
    (path: string | undefined): void => {
      pickMutation.reset()
      registerMutation.reset()
      createMutation.reset()
      setBrowseTarget({ path })
    },
    [createMutation, pickMutation, registerMutation],
  )

  useEffect(() => {
    if (listingQuery.data === undefined || listingQuery.isPlaceholderData || browseTarget === null || !pathMode) return
    const matchedPath = ProjectFolderPickerModel.uniqueMatchingDirectoryPath(listingQuery.data, query)
    if (matchedPath === null || matchedPath === listingQuery.data.path) return
    browse(matchedPath)
  }, [browse, browseTarget, listingQuery.data, listingQuery.isPlaceholderData, pathMode, query])

  const chooseWithSystemPicker = (): void => {
    registerMutation.reset()
    createMutation.reset()
    pickMutation.mutate(undefined, {
      onSuccess: pickedPath => {
        if (pickedPath !== null) browse(pickedPath)
      },
    })
  }

  const registerWorkspacePath = (path: string): void => {
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
    if (event.key === 'Enter') {
      event.preventDefault()
      const pathQuery = query.trim()
      if (pathMode && pathQuery.length > 0) {
        const matchingPaths = listing === null ? null : ProjectFolderPickerModel.matchingDirectoryPaths(listing, pathQuery)
        if (matchingPaths !== null && matchingPaths.length > 0) {
          const entry = folderEntries[selectedIndex]
          if (entry !== undefined) browse(entry.path)
          return
        }
        const requestedPath = ProjectFolderPickerModel.resolvePathQuery(pathQuery, listing?.home)
        if (ProjectFolderPickerModel.isHomeRelativePathQuery(pathQuery) && requestedPath === null) return
        const path = requestedPath ?? pathQuery
        if (listing?.path !== path) {
          browse(path)
          return
        }
      }
      selectVisibleItem()
    }
  }

  const title = props.title ?? (props.mode === 'directories' ? 'Choose a folder' : 'Choose a project or folder')

  return (
    <Dialog
      onOpenChange={(open: boolean) => {
        if (!open) props.onClose()
      }}
      open
    >
      <DialogContent
        className="dshx-root dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-2xl"
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
            : 'Search registered projects, or type an absolute or ~/ path to browse folders; a unique match opens automatically.'}
        </DialogDescription>
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:p-2">
          <div className="dshx:relative dshx:flex-1">
            <SearchIcon
              aria-hidden
              className="dshx:pointer-events-none dshx:absolute dshx:top-1/2 dshx:left-2.5 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground"
            />
            <Input
              aria-label={props.mode === 'directories' ? 'Enter a folder path' : 'Search projects or enter a folder path'}
              autoComplete="off"
              className="dshx:h-9 dshx:pl-8"
              onChange={event => {
                const nextQuery = event.currentTarget.value
                const nextPath = ProjectFolderPickerModel.resolvePathQuery(nextQuery, listing?.home)
                setQuery(nextQuery)
                if (ProjectFolderPickerModel.isHomeRelativePathQuery(nextQuery)) {
                  if (listing === null || nextPath === null || !ProjectFolderPickerModel.isPathAtOrWithin(nextPath, listing.path)) {
                    setBrowseTarget(current => (current !== null && current.path === undefined ? current : { path: undefined }))
                  }
                } else if (nextQuery.trim().startsWith('/')) {
                  if (
                    listing === null ||
                    (nextPath !== null &&
                      ProjectFolderPickerModel.isPathAtOrWithin(nextPath, listing.home) &&
                      !ProjectFolderPickerModel.isPathAtOrWithin(nextPath, listing.path))
                  ) {
                    setBrowseTarget(current => (current !== null && current.path === undefined ? current : { path: undefined }))
                  }
                } else if (!ProjectFolderPickerModel.isPathQuery(nextQuery)) {
                  setBrowseTarget(null)
                }
                pickMutation.reset()
                registerMutation.reset()
                createMutation.reset()
              }}
              onKeyDown={onKeyDown}
              placeholder={props.placeholder ?? (props.mode === 'directories' ? 'Type a folder path…' : 'Search projects or type a path to browse folders…')}
              ref={searchInput}
              value={query}
            />
          </div>
          {props.showNativePicker !== false && (
            <Button disabled={busy} onClick={() => chooseWithSystemPicker()} type="button" variant="outline">
              <FolderOpenIcon aria-hidden />
              Browse…
            </Button>
          )}
        </div>
        {pathMode ? (
          <>
            {listing !== null && (
              <p className="dshx:px-4 dshx:pt-3 dshx:pb-1.5 dshx:font-mono dshx:text-xs dshx:break-all dshx:text-muted-foreground">{listing.path}</p>
            )}
            <div aria-busy={listingQuery.isFetching} aria-label="Folders" className={cn(listClassName, listing === null && 'dshx:pt-2')} role="listbox">
              {folderEntries.map((entry, index) => (
                <button
                  aria-selected={index === selectedIndex}
                  className={optionClassName(index === selectedIndex)}
                  key={entry.path}
                  onClick={() => browse(entry.path)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  role="option"
                  type="button"
                >
                  <FolderIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
                  <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                    <span className="dshx:truncate dshx:text-sm">{entry.name}</span>
                    <span className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{entry.path}</span>
                  </span>
                  {entry.hidden && <Badge variant="muted">Hidden</Badge>}
                </button>
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
                  {props.mode === 'directories' ? 'Use this folder' : 'Register project'}
                </Button>
              </div>
            )}
            {showListingActions && (
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:p-2">
                <Button disabled={busy} onClick={() => props.onSelect(ProjectFolderPickerModel.folderSelection(listing.path))} size="sm" type="button">
                  Select this folder
                </Button>
                {props.mode !== 'directories' && (
                  <Button disabled={busy} onClick={() => registerCurrentFolder()} size="sm" type="button" variant="outline">
                    Register project
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
            {(hasRecentFolders || hasJjWorkspaces) && (
              <div className="dshx:flex dshx:items-center dshx:gap-3 dshx:px-4 dshx:pt-2">
                {hasRecentFolders && (
                  <Tabs onValueChange={(value: string) => setTab(value === 'recents' ? 'recents' : 'projects')} value={tab}>
                    <TabsList className="dshx:h-7!">
                      <TabsTrigger className="dshx:px-2.5 dshx:text-xs" value="projects">
                        Projects
                      </TabsTrigger>
                      <TabsTrigger className="dshx:px-2.5 dshx:text-xs" value="recents">
                        Recents
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                {hasJjWorkspaces && tab === 'projects' && (
                  <Label className="dshx:ml-auto dshx:flex dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
                    <Switch checked={excludeJjWorkspaces} onCheckedChange={(checked: boolean) => setExcludeJjWorkspaces(checked)} size="sm" />
                    Hide JJ workspaces
                  </Label>
                )}
              </div>
            )}
            <div
              aria-busy={props.loading === true}
              aria-label={tab === 'projects' ? 'Projects' : 'Recent folders'}
              className={cn(listClassName, 'dshx:pt-2')}
              role="listbox"
            >
              {entries.map((entry, index) => (
                <PickerEntryRow
                  active={index === selectedIndex}
                  entry={entry}
                  index={index}
                  key={entry.kind === 'project' ? entry.project.workspaceId : 'recent:' + entry.path}
                  machineName={props.machineName}
                  onHover={() => setSelectedIndex(index)}
                  onSelect={() => props.onSelect(ProjectFolderPickerModel.pickerEntrySelection(entry))}
                />
              ))}
              {entries.length === 0 && (
                <p className={emptyClassName}>
                  {props.loading === true ? 'Loading projects…' : tab === 'projects' ? 'No registered projects match.' : 'No recent folders match.'}
                </p>
              )}
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
        <footer className="dshx:flex dshx:items-center dshx:gap-4 dshx:border-t dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>
            Navigate
          </span>
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Kbd>Enter</Kbd>
            Select / open
          </span>
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Kbd>Esc</Kbd>
            Close
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

interface PickerEntryRowProps {
  readonly entry: PickerEntry
  readonly index: number
  readonly active: boolean
  readonly machineName: string | undefined
  readonly onHover: () => void
  readonly onSelect: () => void
}

const PickerEntryRow = (props: PickerEntryRowProps): JSX.Element => {
  const title = props.entry.kind === 'project' ? props.entry.project.title : (props.entry.path.split('/').filter(Boolean).at(-1) ?? props.entry.path)
  const path = props.entry.kind === 'project' ? props.entry.project.canonicalPath : props.entry.path
  return (
    <button
      aria-selected={props.active}
      className={optionClassName(props.active)}
      onClick={props.onSelect}
      onMouseEnter={props.onHover}
      role="option"
      type="button"
    >
      {props.entry.kind === 'project' ? (
        <span
          aria-hidden
          className={cn(
            'dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-[11px] dshx:font-semibold',
            projectGlyphTone(title),
          )}
        >
          {title.slice(0, 2).toLocaleUpperCase()}
        </span>
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
        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
          {props.machineName === undefined ? null : `${props.machineName} · `}
          <span className="dshx:font-mono">{path}</span>
        </span>
      </span>
      {props.index < 9 && (
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>{props.index + 1}</Kbd>
        </KbdGroup>
      )}
    </button>
  )
}
