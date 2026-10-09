import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMemo, useState, type ReactNode } from 'react'
import type { FileStat, FileStatus } from './api.js'
import { buildFileTree, splitFilePath, type FileTreeNode } from './file-tree.js'

export type FileView = 'flat' | 'tree'

const STATUS_TONE = {
  M: 'dshx:text-warning',
  A: 'dshx:text-success',
  D: 'dshx:text-destructive',
  R: 'dshx:text-info',
  C: 'dshx:text-info',
} satisfies Record<FileStatus, string>

const STATUS_LABEL = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied' } satisfies Record<FileStatus, string>

export const FileStatusLetter = (props: { readonly status: FileStatus; readonly className?: string }): JSX.Element => (
  <span
    aria-label={STATUS_LABEL[props.status]}
    className={cn('dshx:w-3 dshx:flex-none dshx:text-center dshx:font-mono dshx:text-[11px] dshx:font-semibold', STATUS_TONE[props.status], props.className)}
    title={STATUS_LABEL[props.status]}
  >
    {props.status}
  </span>
)

export const LineCounts = (props: { readonly additions: number; readonly deletions: number; readonly className?: string }): JSX.Element => (
  <span className={cn('dshx:flex dshx:flex-none dshx:gap-1 dshx:font-mono dshx:text-[11px]', props.className)}>
    <span className="dshx:text-success">+{props.additions}</span>
    <span className="dshx:text-destructive">−{props.deletions}</span>
  </span>
)

export const FileViewToggle = (props: { readonly value: FileView; readonly onChange: (value: FileView) => void }): JSX.Element => (
  <ToggleGroup
    aria-label="Changed file layout"
    className="dshx:h-5 dshx:rounded-sm dshx:bg-muted/60 dshx:p-px"
    onValueChange={value => {
      if (value === 'flat' || value === 'tree') props.onChange(value)
    }}
    size="sm"
    type="single"
    value={props.value}
  >
    {(['flat', 'tree'] as const).map(option => (
      <ToggleGroupItem
        className="dshx:h-[18px] dshx:min-w-0 dshx:rounded-sm! dshx:px-1.5 dshx:text-[11px] dshx:font-normal dshx:text-muted-foreground dshx:data-[state=on]:bg-background dshx:data-[state=on]:font-semibold dshx:data-[state=on]:text-foreground"
        key={option}
        value={option}
      >
        {option === 'flat' ? 'Flat' : 'Tree'}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)

interface ChangedFilesProps {
  readonly files: readonly FileStat[]
  readonly view: FileView
  readonly showCounts?: boolean
  readonly statusAtEnd?: boolean
  readonly selectedPaths?: readonly string[]
  readonly selectionLabel?: string
  readonly onSelectionChange?: (paths: readonly string[]) => void
  readonly onOpen: (path: string) => void
  /** Adds "Open in editor" to the row context menu and to ⌘/Ctrl-click on the path; deleted files are skipped. */
  readonly onOpenInEditor?: (path: string) => void
  readonly actions?: (file: FileStat) => ReactNode
  readonly className?: string
}

/** Changed files of one revision as a flat list or a folder tree, with status letters and line counts. */
export const ChangedFiles = (props: ChangedFilesProps): JSX.Element => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const tree = useMemo(() => buildFileTree(props.files), [props.files])
  const selected = new Set(props.selectedPaths ?? [])
  const onSelectionChange = props.onSelectionChange

  const setSelected = (paths: readonly string[], checked: boolean): void => {
    if (onSelectionChange === undefined) return
    const next = new Set(selected)
    for (const path of paths) {
      if (checked) next.add(path)
      else next.delete(path)
    }
    onSelectionChange([...next])
  }

  const fileRow = (file: FileStat, depth: number): JSX.Element => {
    const parts = splitFilePath(file.path)
    const openInEditor = file.status === 'D' ? undefined : props.onOpenInEditor
    const row = (
      <li
        className="dshx:group/file dshx:flex dshx:h-6 dshx:items-center dshx:gap-1.5 dshx:rounded-sm dshx:pr-1 dshx:hover:bg-accent"
        key={file.path}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {onSelectionChange !== undefined && (
          <Checkbox
            aria-label={`${props.selectionLabel ?? 'Select'} ${file.path}`}
            checked={selected.has(file.path)}
            className="dshx:size-3.5"
            onCheckedChange={checked => setSelected([file.path], checked === true)}
          />
        )}
        <button
          className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          onClick={event => {
            if (openInEditor !== undefined && (event.metaKey || event.ctrlKey)) openInEditor(file.path)
            else props.onOpen(file.path)
          }}
          title={openInEditor === undefined ? `${file.path} · open diff` : `${file.path} · open diff (⌘/Ctrl-click: open in editor)`}
          type="button"
        >
          {props.statusAtEnd !== true && <FileStatusLetter status={file.status} />}
          <span className={cn('dshx:flex-none dshx:truncate dshx:text-xs dshx:font-medium', file.status === 'D' && 'dshx:line-through dshx:opacity-70')}>
            {parts.name}
          </span>
          {props.view === 'flat' && parts.directory.length > 0 && (
            <span className="dshx:min-w-0 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{parts.directory}</span>
          )}
          {props.showCounts !== false && <LineCounts additions={file.additions} deletions={file.deletions} />}
        </button>
        {props.actions !== undefined && (
          <span className="dshx:ml-auto dshx:flex dshx:flex-none dshx:items-center dshx:opacity-0 dshx:group-hover/file:opacity-100 dshx:focus-within:opacity-100">
            {props.actions(file)}
          </span>
        )}
        {props.statusAtEnd === true && <FileStatusLetter status={file.status} />}
      </li>
    )
    if (props.onOpenInEditor === undefined) return row
    return (
      <ContextMenu key={file.path}>
        <ContextMenuTrigger asChild onContextMenu={event => event.stopPropagation()}>
          {row}
        </ContextMenuTrigger>
        <ContextMenuContent className="dshx-root dshx:w-52">
          <ContextMenuLabel className="dshx:truncate dshx:font-mono dshx:text-xs">{file.path}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => props.onOpen(file.path)}>Open diff</ContextMenuItem>
          <ContextMenuItem disabled={openInEditor === undefined} onSelect={() => openInEditor?.(file.path)}>
            Open in editor
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const descendantFiles = (node: FileTreeNode<FileStat>): FileStat[] => (node.file !== null ? [node.file] : node.children.flatMap(descendantFiles))

  const treeRows = (nodes: readonly FileTreeNode<FileStat>[], depth: number): JSX.Element[] =>
    nodes.flatMap(node => {
      if (node.file !== null) return [fileRow(node.file, depth)]
      const open = !collapsed.has(node.path)
      const subtree = descendantFiles(node).map(file => file.path)
      const selectedCount = subtree.filter(path => selected.has(path)).length
      return [
        <li
          className="dshx:flex dshx:h-6 dshx:items-center dshx:gap-1.5 dshx:rounded-sm dshx:pr-1 dshx:hover:bg-accent"
          key={'dir:' + node.path}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {onSelectionChange !== undefined && (
            <Checkbox
              aria-label={`${props.selectionLabel ?? 'Select'} all files in ${node.path}`}
              checked={selectedCount === 0 ? false : selectedCount === subtree.length ? true : 'indeterminate'}
              className="dshx:size-3.5"
              onCheckedChange={checked => setSelected(subtree, checked === true)}
            />
          )}
          <button
            aria-expanded={open}
            className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1 dshx:text-left dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground"
            onClick={() =>
              setCollapsed(current => {
                const next = new Set(current)
                if (next.has(node.path)) next.delete(node.path)
                else next.add(node.path)
                return next
              })
            }
            type="button"
          >
            <ChevronRightIcon className={cn('dshx:size-3 dshx:flex-none dshx:transition-transform', open && 'dshx:rotate-90')} />
            <span className="dshx:truncate">{node.name}</span>
            <span className="dshx:ml-auto dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:font-mono dshx:text-[10px]">{node.fileCount}</span>
          </button>
        </li>,
        ...(open ? treeRows(node.children, depth + 1) : []),
      ]
    })

  return (
    <ul aria-label="Changed files" className={cn('dshx:flex dshx:flex-col', props.className)}>
      {props.view === 'tree' ? treeRows(tree, 0) : props.files.map(file => fileRow(file, 0))}
    </ul>
  )
}
