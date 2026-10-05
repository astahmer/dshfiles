import {
  Button,
  IconFolderCloseRegular,
  IconFolderOpenOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Modal,
  ShortcutKeys,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState, Notice, joinClassNames } from '@dshfiles/plugin-ui'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import styles from './project-folder-picker.module.css'
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

const optionClassName = (active: boolean): string => joinClassNames(styles.item, active && styles.active)

export const ProjectFolderPicker = (props: ProjectFolderPickerProps): JSX.Element => {
  const [query, setQuery] = useState('')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [newDirectoryName, setNewDirectoryName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const generation = useRef(0)
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

  return (
    <Modal className={styles.dialog} headless onClose={props.onClose} open title={props.title ?? 'Choose a project or folder'}>
      <div className={styles.searchRow}>
        <Input
          aria-label="Search projects or enter a folder path"
          autoComplete="off"
          className={styles.grow}
          data-modal-autofocus
          icon={<IconSearchOutlineRegular />}
          onChange={event => {
            setQuery(event.currentTarget.value)
            if (!event.currentTarget.value.startsWith('/')) setListing(null)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search projects or type / for a folder…"
          value={query}
        />
        <Button disabled={busy} icon={<IconFolderOpenOutlineRegular />} onClick={() => void chooseWithSystemPicker()} type="button" variant="outline">
          Browse…
        </Button>
      </div>
      {pathMode ? (
        <>
          {listing !== null && <p className={styles.path}>{listing.path}</p>}
          <div className={styles.list} role="listbox" aria-label="Folders">
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
                <IconFolderCloseRegular className={styles.folderGlyph} />
                <span className={styles.itemText}>
                  <span className={styles.itemTitle}>{entry.name}</span>
                  <span className={styles.itemDetail}>{entry.path}</span>
                </span>
                {entry.hidden && <Tag tone="quiet">Hidden</Tag>}
              </button>
            ))}
            {listing === null && <EmptyState compact description="Enter an absolute folder path, then press Enter." />}
            {listing !== null && folderEntries.length === 0 && <EmptyState compact description="No folders here." />}
          </div>
          {listing !== null && (
            <div className={styles.folderActions}>
              <Button disabled={busy} onClick={() => props.onSelect(folderSelection(listing.path))} type="button" variant="primary">
                Select this folder
              </Button>
              <Button disabled={busy} onClick={() => void registerCurrentFolder()} type="button" variant="outline">
                Register project
              </Button>
              <form
                className={styles.createFolder}
                onSubmit={event => {
                  event.preventDefault()
                  void createFolder()
                }}
              >
                <Input
                  aria-label="New folder name"
                  className={styles.grow}
                  onChange={event => setNewDirectoryName(event.currentTarget.value)}
                  placeholder="New folder name"
                  value={newDirectoryName}
                />
                <Button disabled={busy || newDirectoryName.trim().length === 0} type="submit" variant="outline">
                  Create folder
                </Button>
              </form>
              {listing.truncated && <Tag tone="warning">Folder list is truncated.</Tag>}
            </div>
          )}
        </>
      ) : (
        <>
          <p className={styles.sectionLabel}>Projects</p>
          <div className={styles.list} role="listbox" aria-label="Registered projects">
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
                <span className={styles.projectGlyph} aria-hidden>
                  {project.title.slice(0, 2).toLocaleUpperCase()}
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemTitle}>{project.title}</span>
                  <span className={styles.itemDetail}>
                    {props.machineName === undefined ? null : `${props.machineName} · `}
                    {project.canonicalPath}
                  </span>
                </span>
                {index < 9 && <ShortcutKeys keys={['⌘', String(index + 1)]} />}
              </button>
            ))}
            {matchingProjects.length === 0 && <EmptyState compact description="No registered projects match." />}
          </div>
        </>
      )}
      {error !== null && (
        <Notice className={styles.error} tone="danger">
          {error}
        </Notice>
      )}
      <footer className={styles.footer}>
        <span className={styles.hint}>
          <ShortcutKeys keys={['↑', '↓']} /> Navigate
        </span>
        <span className={styles.hint}>
          <ShortcutKeys keys={['Enter']} /> Select / open
        </span>
        <span className={styles.hint}>
          <ShortcutKeys keys={['Esc']} /> Close
        </span>
      </footer>
    </Modal>
  )
}
