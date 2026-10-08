import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { FolderIcon, FolderOpenIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { filterRegisteredProjects, folderSelection, movePickerSelection, workspaceSelection } from './project-folder-picker-model.js'

export interface RegisteredProject {
  readonly workspaceId: string
  readonly title: string
  readonly canonicalPath: string
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
  readonly onRegisterWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
  readonly onSelect: (selection: ProjectFolderSelection) => void
  readonly onClose: () => void
  readonly title?: string
  /**
   * Identity of the machine these paths live on, shown with each row the way the
   * reference does. The picker is host-agnostic, so this is supplied by the
   * caller that knows it rather than read here.
   */
  readonly machineName?: string
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
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [newDirectoryName, setNewDirectoryName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const pathMode = query.startsWith('/')
  const matchingProjects = useMemo(() => filterRegisteredProjects(props.projects, query), [props.projects, query])
  const folderEntries = pathMode ? (listing?.entries ?? []) : []
  const itemCount = pathMode ? folderEntries.length : matchingProjects.length

  useEffect(
    () => () => {
      generation.current += 1
      activeRequest.current?.abort()
    },
    [],
  )

  useEffect(() => setSelectedIndex(0), [query, listing?.path])

  const browse = async (path: string | undefined): Promise<void> => {
    const requestId = ++generation.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setBusy(true)
    setError(null)
    try {
      const result = await props.directoryPicker.list(path, controller.signal)
      if (requestId !== generation.current) return
      setListing(result)
      setQuery(result.path)
    } catch {
      if (requestId === generation.current && !controller.signal.aborted) {
        setError('This folder could not be opened.')
      }
    } finally {
      if (requestId === generation.current) setBusy(false)
    }
  }

  const chooseWithSystemPicker = async (): Promise<void> => {
    const requestId = ++generation.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setBusy(true)
    setError(null)
    try {
      const pickedPath = await props.directoryPicker.pick(controller.signal)
      if (requestId !== generation.current || pickedPath === null) return
      await browse(pickedPath)
    } catch {
      if (requestId === generation.current && !controller.signal.aborted) {
        setError('The folder picker is unavailable on this Host.')
      }
    } finally {
      if (requestId === generation.current) setBusy(false)
    }
  }

  const registerCurrentFolder = async (): Promise<void> => {
    if (listing === null) return
    setBusy(true)
    setError(null)
    try {
      const project = await props.onRegisterWorkspace(listing.path)
      props.onSelect({
        kind: 'workspace',
        workspaceId: project.workspaceId,
        canonicalPath: project.canonicalPath,
        title: project.title,
      })
    } catch {
      setError('This folder could not be registered as a project.')
    } finally {
      setBusy(false)
    }
  }

  const createFolder = async (): Promise<void> => {
    if (listing === null || newDirectoryName.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const createdPath = await props.directoryPicker.createDirectory(listing.path, newDirectoryName.trim())
      setNewDirectoryName('')
      await browse(createdPath)
    } catch {
      setError('This folder could not be created.')
    } finally {
      setBusy(false)
    }
  }

  const selectVisibleItem = (): void => {
    if (pathMode) {
      const entry = folderEntries[selectedIndex]
      if (entry !== undefined) void browse(entry.path)
      return
    }
    const project = matchingProjects[selectedIndex]
    if (project !== undefined) props.onSelect(workspaceSelection(project))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key) && !pathMode) {
      const project = matchingProjects[Number(event.key) - 1]
      if (project !== undefined) {
        event.preventDefault()
        props.onSelect(workspaceSelection(project))
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (itemCount === 0) return
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 'down' : 'up'
      setSelectedIndex(index => movePickerSelection(index, itemCount, direction))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (pathMode && query.trim().length > 0 && listing?.path !== query.trim()) {
        void browse(query.trim())
      } else {
        selectVisibleItem()
      }
    }
  }

  const title = props.title ?? 'Choose a project or folder'

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) props.onClose()
      }}
      open
    >
      <DialogContent
        className="dshx-root dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-2xl"
        onOpenAutoFocus={event => {
          event.preventDefault()
          searchInput.current?.focus()
        }}
        showCloseButton={false}
      >
        <DialogTitle className="dshx:sr-only">{title}</DialogTitle>
        <DialogDescription className="dshx:sr-only">Search registered projects, or type a path starting with / to browse folders.</DialogDescription>
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:p-2">
          <div className="dshx:relative dshx:flex-1">
            <SearchIcon
              aria-hidden
              className="dshx:pointer-events-none dshx:absolute dshx:top-1/2 dshx:left-2.5 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground"
            />
            <Input
              aria-label="Search projects or enter a folder path"
              autoComplete="off"
              className="dshx:h-9 dshx:pl-8"
              onChange={event => {
                setQuery(event.currentTarget.value)
                if (!event.currentTarget.value.startsWith('/')) setListing(null)
                setError(null)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search projects or type / for a folder…"
              ref={searchInput}
              value={query}
            />
          </div>
          <Button disabled={busy} onClick={() => void chooseWithSystemPicker()} type="button" variant="outline">
            <FolderOpenIcon aria-hidden />
            Browse…
          </Button>
        </div>
        {pathMode ? (
          <>
            {listing !== null && <p className="dshx:px-4 dshx:pt-3 dshx:pb-1.5 dshx:font-mono dshx:text-xs dshx:break-all dshx:text-muted-foreground">{listing.path}</p>}
            <div aria-label="Folders" className={cn(listClassName, listing === null && 'dshx:pt-2')} role="listbox">
              {folderEntries.map((entry, index) => (
                <button
                  aria-selected={index === selectedIndex}
                  className={optionClassName(index === selectedIndex)}
                  key={entry.path}
                  onClick={() => void browse(entry.path)}
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
              {listing === null && <p className={emptyClassName}>Enter an absolute folder path, then press Enter.</p>}
              {listing !== null && folderEntries.length === 0 && <p className={emptyClassName}>No folders here.</p>}
            </div>
            {listing !== null && (
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:p-2">
                <Button disabled={busy} onClick={() => props.onSelect(folderSelection(listing.path))} size="sm" type="button">
                  Select this folder
                </Button>
                <Button disabled={busy} onClick={() => void registerCurrentFolder()} size="sm" type="button" variant="outline">
                  Register project
                </Button>
                <form
                  className="dshx:flex dshx:min-w-60 dshx:flex-1 dshx:items-center dshx:gap-2"
                  onSubmit={event => {
                    event.preventDefault()
                    void createFolder()
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
                {listing.truncated && (
                  <Badge variant="warning">
                    Folder list is truncated.
                  </Badge>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="dshx:px-4 dshx:pt-3 dshx:pb-1.5 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Projects</p>
            <div aria-label="Registered projects" className={listClassName} role="listbox">
              {matchingProjects.map((project, index) => (
                <button
                  aria-selected={index === selectedIndex}
                  className={optionClassName(index === selectedIndex)}
                  key={project.workspaceId}
                  onClick={() => props.onSelect(workspaceSelection(project))}
                  onMouseEnter={() => setSelectedIndex(index)}
                  role="option"
                  type="button"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-[11px] dshx:font-semibold',
                      projectGlyphTone(project.title),
                    )}
                  >
                    {project.title.slice(0, 2).toLocaleUpperCase()}
                  </span>
                  <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                    <span className="dshx:truncate dshx:text-sm dshx:font-medium">{project.title}</span>
                    <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                      {props.machineName === undefined ? null : `${props.machineName} · `}
                      <span className="dshx:font-mono">{project.canonicalPath}</span>
                    </span>
                  </span>
                  {index < 9 && (
                    <KbdGroup>
                      <Kbd>⌘</Kbd>
                      <Kbd>{index + 1}</Kbd>
                    </KbdGroup>
                  )}
                </button>
              ))}
              {matchingProjects.length === 0 && <p className={emptyClassName}>No registered projects match.</p>}
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
