/**
 * Sidebar folders (b:952m), the rail half: the folders a person sees, the verbs the rail offers on them (the same Host
 * methods the agent tools call, `threadSidebarTreeApi`) and the Undo each change offers. The Host stores the tree;
 * this module only resolves it against the pages and views this browser has, and renders it.
 */
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import {
  BookOpenIcon,
  BookmarkIcon,
  BugIcon,
  CodeIcon,
  DatabaseIcon,
  EllipsisIcon,
  EyeIcon,
  FlaskConicalIcon,
  FolderIcon,
  GitPullRequestIcon,
  GlobeIcon,
  HeartIcon,
  LayoutDashboardIcon,
  PanelRightIcon,
  PlusIcon,
  RocketIcon,
  ShieldIcon,
  StarIcon,
  TerminalIcon,
  UsersIcon,
  WrenchIcon,
  ZapIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { SidebarFolderTargets, WorkbenchPorts } from '@dshfiles/workbench/shell-merge'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ResolvedDestination } from './destinations.js'
import { threadSidebarTreeApi, type SidebarTreeOutput } from './sidebar-tree-api.js'
import { EMPTY_SIDEBAR_TREE, SidebarTrees, sidebarTreeSchema, type ResolvedEntry, type ResolvedFolder, type SidebarPanel } from './sidebar-tree.js'

/** The icons a user folder can take: a short, recognisable set rather than all of lucide (the bundle stays small). */
export const FOLDER_ICONS = {
  folder: FolderIcon,
  star: StarIcon,
  bookmark: BookmarkIcon,
  eye: EyeIcon,
  'git-pull-request': GitPullRequestIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  bug: BugIcon,
  'flask-conical': FlaskConicalIcon,
  rocket: RocketIcon,
  wrench: WrenchIcon,
  'book-open': BookOpenIcon,
  'layout-dashboard': LayoutDashboardIcon,
  database: DatabaseIcon,
  globe: GlobeIcon,
  users: UsersIcon,
  shield: ShieldIcon,
  zap: ZapIcon,
  heart: HeartIcon,
} satisfies Record<string, LucideIcon>

const isFolderIconName = (name: string): name is keyof typeof FOLDER_ICONS => Object.hasOwn(FOLDER_ICONS, name)
const iconOf = (name: string): LucideIcon => (isFolderIconName(name) ? FOLDER_ICONS[name] : FolderIcon)

export const FolderGlyph = (props: { readonly name: string; readonly className?: string }): JSX.Element =>
  createElement(iconOf(props.name), { className: props.className ?? 'dshx:size-4', strokeWidth: 1.5, 'aria-hidden': true })

/** A change the rail just made, with the inverse that undoes it. */
export interface FolderUndo {
  readonly message: string
  readonly tone: 'info' | 'danger'
  readonly undo?: () => void
}

export interface FolderActions {
  readonly createFolder: (title: string, icon: string) => void
  readonly updateFolder: (id: string, change: { readonly title?: string; readonly icon?: string; readonly hidden?: boolean }) => void
  readonly deleteFolder: (id: string) => void
  readonly addPanel: (viewId: string, folderId: string) => void
  readonly movePanel: (viewId: string, folderId: string, beforeViewId?: string) => void
  readonly removePanel: (viewId: string) => void
  readonly setKeep: (viewId: string, keep: boolean) => void
}

/** What the rail needs to draw folders: the resolved folders, the panels a folder can take, and the verbs. */
export interface SidebarFolderUi {
  readonly folders: readonly ResolvedFolder[]
  readonly panels: readonly SidebarPanel[]
  readonly actions: FolderActions
  readonly notice: FolderUndo | null
  readonly dismissNotice: () => void
  /** Opens one row: a page in the stage, any other view through the Workbench. */
  readonly open: (entry: Pick<ResolvedEntry, 'viewId' | 'kind'>) => void
}

const decodeTree = Schema.decodeUnknownOption(sidebarTreeSchema)

const KEPT_STORAGE_KEY = 'dshfiles.thread-sidebar.kept-panes.v1'
const decodeKept = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const readKept = (): readonly string[] => {
  try {
    return Option.getOrElse(decodeKept(localStorage.getItem(KEPT_STORAGE_KEY) ?? '[]'), () => [])
  } catch {
    return []
  }
}
const writeKept = (ids: readonly string[]): void => {
  try {
    localStorage.setItem(KEPT_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Presentation bookkeeping only: a full storage re-applies the keeps on the next load.
  }
}

/** Where a view sits now, so a move or a remove can be undone to the same place. */
const placeOf = (folders: readonly ResolvedFolder[], viewId: string): { readonly folderId: string; readonly beforeViewId: string | undefined } | undefined => {
  for (const folder of folders) {
    const index = folder.entries.findIndex(entry => entry.viewId === viewId)
    if (index === -1) continue
    return { folderId: folder.id, beforeViewId: folder.entries[index + 1]?.viewId }
  }
  return undefined
}

/** A change's Undo bar, with its inverse when there is one to run. */
const undoable = (message: string, undo: (() => void) | undefined): FolderUndo =>
  undo === undefined ? { tone: 'info', message } : { tone: 'info', message, undo }

/** A refusal from the tree verbs already names its recovery; anything else is most often a Host that predates them. */
const messageOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : ''
  if (message !== '' && /sidebar|folder/iu.test(message)) return message
  return `The sidebar could not save that change${message === '' ? '' : ` (${message})`}. If DSH was updated recently, restart it when idle, then retry.`
}

/**
 * The folders for this browser and the rail's verbs. Every write goes to the Host (the same methods the agent tools
 * call) and offers its inverse as Undo; the folders refresh from the Host settings the write committed.
 */
export const useSidebarFolders = (input: {
  readonly storedTree: unknown
  readonly destinations: readonly ResolvedDestination[]
  readonly panels: readonly SidebarPanel[]
  readonly selectPanel: (panelId: string) => void
}): SidebarFolderUi => {
  const api = useApi(threadSidebarTreeApi)
  const tree = useMemo(() => Option.getOrElse(decodeTree(input.storedTree), () => EMPTY_SIDEBAR_TREE), [input.storedTree])
  const sections = useMemo(
    () =>
      input.destinations.flatMap(destination =>
        destination.sections.map(section => ({
          panelId: section.panelId,
          destination: section.destination,
          label: section.label,
          description: section.description,
          unmapped: section.unmapped,
        })),
      ),
    [input.destinations],
  )
  const folders = useMemo(() => SidebarTrees.resolve({ tree, sections, panels: input.panels }), [tree, sections, input.panels])
  const latest = useRef(folders)
  latest.current = folders
  const [notice, setNotice] = useState<FolderUndo | null>(null)

  const run = useCallback((write: () => Promise<SidebarTreeOutput>, done?: FolderUndo) => {
    // A new change retires the last one's Undo at once: an Undo still on screen must never undo an older change.
    setNotice(null)
    const settle = async (): Promise<void> => {
      try {
        await write()
        if (done !== undefined) setNotice(done)
      } catch (error) {
        setNotice({ tone: 'danger', message: messageOf(error) })
      }
    }
    void settle()
  }, [])

  const folderTitle = (id: string): string => latest.current.find(folder => folder.id === id)?.title ?? id

  const actions = useMemo<FolderActions>(
    () => ({
      createFolder: (title, icon) => {
        setNotice(null)
        const create = async (): Promise<void> => {
          try {
            const result = await api.folderCreate({ title, icon })
            setNotice(undoable(`Folder “${title}” created.`, () => run(() => api.folderDelete({ id: result.folderId, confirm: true }))))
          } catch (error) {
            setNotice({ tone: 'danger', message: messageOf(error) })
          }
        }
        void create()
      },
      updateFolder: (id, change) => {
        const before = latest.current.find(folder => folder.id === id)
        const message =
          change.hidden === true ? `Folder “${folderTitle(id)}” hidden.` : change.hidden === false ? `Folder “${folderTitle(id)}” shown.` : 'Folder updated.'
        const undo =
          before === undefined
            ? undefined
            : () => run(() => api.folderUpdate(change.hidden === undefined ? { id, title: before.title, icon: before.icon } : { id, hidden: before.hidden }))
        run(() => api.folderUpdate({ id, ...change }), undoable(message, undo))
      },
      deleteFolder: id =>
        run(
          () => api.folderDelete({ id, confirm: true }),
          undoable(`Folder “${folderTitle(id)}” deleted; its panels moved to Settings › Other pages.`, () => run(() => api.folderRestore({ id }))),
        ),
      addPanel: (viewId, folderId) =>
        run(
          () => api.panelAdd({ viewId, folderId }),
          undoable(`Added to ${folderTitle(folderId)}.`, () => run(() => api.panelRemove({ viewId }))),
        ),
      // Filing a panel elsewhere is the add verb: it also covers a mapped page the Host has not seen reported yet.
      movePanel: (viewId, folderId, beforeViewId) => {
        const from = placeOf(latest.current, viewId)
        run(
          () => api.panelAdd({ viewId, folderId, beforeViewId }),
          undoable(`Moved to ${folderTitle(folderId)}.`, from === undefined ? undefined : () => run(() => api.panelAdd({ viewId, ...from }))),
        )
      },
      removePanel: viewId => {
        const from = placeOf(latest.current, viewId)
        run(
          () => api.panelRemove({ viewId }),
          undoable('Removed from the sidebar. ⌘K still opens it.', from === undefined ? undefined : () => run(() => api.panelAdd({ viewId, ...from }))),
        )
      },
      setKeep: (viewId, keep) => {
        const from = placeOf(latest.current, viewId)
        if (from === undefined) return
        run(
          () => api.panelAdd({ viewId, ...from, keep }),
          undoable(keep ? 'Kept in the sidebar.' : 'No longer kept in the sidebar.', () => run(() => api.panelAdd({ viewId, ...from, keep: !keep }))),
        )
      },
    }),
    // folderTitle reads the latest folders through the ref.
    [api, run],
  )

  // Keep in sidebar: apply each kept panel once per browser; a pane the person closes stays closed until kept again.
  useEffect(() => {
    const kept = new Set(folders.flatMap(folder => folder.entries.filter(entry => entry.keep).map(entry => entry.viewId)))
    const applied = new Set(readKept())
    for (const viewId of kept) if (!applied.has(viewId)) WorkbenchPorts.leftKeep().request({ viewId, keep: true })
    for (const viewId of applied) if (!kept.has(viewId)) WorkbenchPorts.leftKeep().request({ viewId, keep: false })
    if (kept.size !== applied.size || [...kept].some(viewId => !applied.has(viewId))) writeKept([...kept])
  }, [folders])

  // The pane tab menu's Add to sidebar ▸ ‹folder› (Workbench) files panels through the same verb.
  useEffect(
    () =>
      SidebarFolderTargets.provide({
        folders: () => latest.current.filter(folder => !folder.hidden && folder.id !== 'threads').map(folder => ({ id: folder.id, title: folder.title })),
        add: (viewId, folderId) => actions.addPanel(viewId, folderId),
      }),
    [actions],
  )

  const { selectPanel } = input
  const open = useCallback(
    (entry: Pick<ResolvedEntry, 'viewId' | 'kind'>) => {
      if (entry.kind === 'page') selectPanel(entry.viewId)
      else workbenchPanels().open(entry.viewId)
    },
    [selectPanel],
  )

  return { folders, panels: input.panels, actions, notice, dismissNotice: () => setNotice(null), open }
}

/** The Undo bar under the folder list: the last change and its inverse, gone after a few seconds. */
export const FolderNotice = (props: { readonly notice: FolderUndo | null; readonly dismiss: () => void }): JSX.Element | null => {
  const { notice, dismiss } = props
  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(dismiss, notice.tone === 'danger' ? 12_000 : 8_000)
    return () => window.clearTimeout(timer)
  }, [notice, dismiss])
  if (notice === null) return null
  return (
    <div
      role="status"
      data-sidebar-folder-notice=""
      className={cn(
        'dshx:mx-2 dshx:mb-2 dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:bg-card dshx:px-2.5 dshx:py-1.5 dshx:text-xs dshx:shadow-sm',
        notice.tone === 'danger' && 'dshx:border-destructive/40 dshx:text-destructive',
      )}
    >
      <span className="dshx:min-w-0 dshx:flex-1">{notice.message}</span>
      {notice.undo === undefined ? null : (
        <Button
          size="sm"
          variant="ghost"
          className="dshx:h-6 dshx:px-2 dshx:font-medium"
          onClick={() => {
            notice.undo?.()
            dismiss()
          }}
        >
          Undo
        </Button>
      )}
    </div>
  )
}

/** One row's ⋯ menu: keep it docked in the sidebar, move it to another folder, take it out. */
export const EntryMenu = (props: { readonly entry: ResolvedEntry; readonly folderId: string; readonly ui: SidebarFolderUi }): JSX.Element => {
  const { entry, folderId, ui } = props
  const targets = ui.folders.filter(folder => folder.id !== folderId && !folder.hidden && folder.id !== 'threads')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Options: ${entry.title}`}
          data-sidebar-entry-menu=""
          className="dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:opacity-0 dshx:outline-none dshx:group-hover/row:opacity-100 dshx:hover:bg-accent dshx:focus-visible:opacity-100 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:data-[state=open]:opacity-100"
        >
          <EllipsisIcon className="dshx:size-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root dshx:w-56">
        <DropdownMenuCheckboxItem checked={entry.keep} onCheckedChange={checked => ui.actions.setKeep(entry.viewId, checked === true)}>
          Keep in sidebar
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to folder…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            {targets.map(folder => (
              <DropdownMenuItem key={folder.id} onSelect={() => ui.actions.movePanel(entry.viewId, folder.id)}>
                <FolderGlyph name={folder.icon} />
                {folder.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => ui.actions.removePanel(entry.viewId)}>Remove from folder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const VIEW_DRAG_TYPE = 'application/x-dshfiles-sidebar-view'

/** A row can be dragged onto another row (to go before it) or onto a folder in the rail (to go at its end). */
export const viewDrag = {
  start: (event: React.DragEvent, viewId: string): void => {
    event.dataTransfer.setData(VIEW_DRAG_TYPE, viewId)
    event.dataTransfer.effectAllowed = 'move'
  },
  accepts: (event: React.DragEvent): boolean => event.dataTransfer.types.includes(VIEW_DRAG_TYPE),
  read: (event: React.DragEvent): string | undefined => {
    const viewId = event.dataTransfer.getData(VIEW_DRAG_TYPE)
    return viewId === '' ? undefined : viewId
  },
}

/** + Add panel: the panels this browser can show that the folder does not hold yet, searchable. */
export const AddPanelButton = (props: { readonly folder: ResolvedFolder; readonly ui: SidebarFolderUi }): JSX.Element => {
  const [open, setOpen] = useState(false)
  const held = new Set(props.folder.entries.map(entry => entry.viewId))
  const candidates = props.ui.panels.filter(panel => !held.has(panel.id))
  const groups: readonly { readonly label: string; readonly kind: SidebarPanel['kind'] }[] = [
    { label: 'Pages', kind: 'page' },
    { label: 'Thread panels', kind: 'facet' },
    { label: 'Views', kind: 'view' },
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-sidebar-add-panel=""
          className="dshx:mt-1 dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:py-1.5 dshx:text-left dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent/60 dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        >
          <PlusIcon className="dshx:size-4" aria-hidden="true" />
          Add panel
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="dshx-root dshx:w-72 dshx:p-0" aria-label={`Add a panel to ${props.folder.title}`}>
        <Command>
          <CommandInput placeholder="Choose a view…" />
          <CommandList>
            <CommandEmpty>No other panel to add. Plugins add their pages and views here.</CommandEmpty>
            {groups.map(group => {
              const items = candidates.filter(panel => panel.kind === group.kind)
              if (items.length === 0) return null
              return (
                <CommandGroup key={group.kind} heading={group.label}>
                  {items.map(panel => (
                    <CommandItem
                      key={panel.id}
                      value={`${panel.title} ${panel.id}`}
                      onSelect={() => {
                        props.ui.actions.addPanel(panel.id, props.folder.id)
                        setOpen(false)
                      }}
                    >
                      {panel.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** The folder heading's ⋯: rename and delete a user folder, hide a built-in one. */
export const FolderMenu = (props: { readonly folder: ResolvedFolder; readonly ui: SidebarFolderUi; readonly onRename: () => void }): JSX.Element | null => {
  const { folder, ui } = props
  if (folder.id === 'threads') return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="dshx:text-muted-foreground" aria-label={`Folder options: ${folder.title}`}>
          <EllipsisIcon className="dshx:size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root dshx:w-48">
        {folder.builtIn ? (
          <DropdownMenuItem onSelect={() => ui.actions.updateFolder(folder.id, { hidden: true })}>Hide folder</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={props.onRename}>Rename…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => ui.actions.deleteFolder(folder.id)}>Delete folder</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** New folder and Rename: a title and an icon from the set. */
export const FolderDialog = (props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly initial?: { readonly title: string; readonly icon: string }
  readonly hidden?: readonly ResolvedFolder[]
  readonly onShow?: (id: string) => void
  readonly onSubmit: (title: string, icon: string) => void
}): JSX.Element => {
  const [title, setTitle] = useState(props.initial?.title ?? '')
  const [icon, setIcon] = useState(props.initial?.icon ?? 'folder')
  useEffect(() => {
    if (!props.open) return
    setTitle(props.initial?.title ?? '')
    setIcon(props.initial?.icon ?? 'folder')
  }, [props.open, props.initial?.title, props.initial?.icon])
  const trimmed = title.trim()
  const submit = (): void => {
    if (trimmed === '' || trimmed.length > 40) return
    props.onSubmit(trimmed, icon)
    props.onOpenChange(false)
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="dshx-root dshx:max-w-sm">
        <DialogHeader>
          <DialogTitle>{props.initial === undefined ? 'New folder' : 'Rename folder'}</DialogTitle>
          <DialogDescription>A folder in the rail holds the panels you file in it.</DialogDescription>
        </DialogHeader>
        <form
          className="dshx:flex dshx:flex-col dshx:gap-3"
          onSubmit={event => {
            event.preventDefault()
            submit()
          }}
        >
          <Input aria-label="Folder name" placeholder="Folder name" maxLength={40} value={title} autoFocus onChange={event => setTitle(event.target.value)} />
          <div role="radiogroup" aria-label="Folder icon" className="dshx:grid dshx:grid-cols-7 dshx:gap-1">
            {Object.keys(FOLDER_ICONS).map(name => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={icon === name}
                aria-label={name}
                onClick={() => setIcon(name)}
                className={cn(
                  'dshx:flex dshx:size-8 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                  icon === name && 'dshx:bg-accent dshx:text-foreground',
                )}
              >
                <FolderGlyph name={name} />
              </button>
            ))}
          </div>
          {props.hidden === undefined || props.hidden.length === 0 ? null : (
            <section aria-label="Hidden folders" className="dshx:flex dshx:flex-col dshx:gap-1">
              <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Hidden folders</h3>
              {props.hidden.map(folder => (
                <div key={folder.id} className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
                  <FolderGlyph name={folder.icon} />
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{folder.title}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => props.onShow?.(folder.id)}>
                    Show
                  </Button>
                </div>
              ))}
            </section>
          )}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={trimmed === ''}>
              {props.initial === undefined ? 'Create folder' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The icon of a row that is not a page (a thread facet, a Workbench view). */
export const ViewGlyph = (): ReactNode => <PanelRightIcon className="dshx:size-4" strokeWidth={1.5} aria-hidden="true" />
