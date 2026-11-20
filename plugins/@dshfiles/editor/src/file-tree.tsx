import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChevronRightIcon, FileIcon, FolderIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useState } from 'react'

export interface TreeProps {
  readonly remote: Pick<ClientRemote, 'workspaceFiles'>
  readonly sessionId: SessionId
  readonly activePath: string | null
  readonly onOpen: (path: string) => void
  /** Filter string to match file/folder names (case-insensitive) */
  readonly filter?: string
}

/** A save or build burst emits many frames; one invalidation per window keeps a listing fresh without refetching per frame. */
const DIRECTORY_INVALIDATION_MS = 50

const ROW =
  'dshx:flex dshx:h-6 dshx:w-full dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:pr-1 dshx:text-left dshx:text-xs dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

/** Check if a name matches the filter (case-insensitive, supports partial matches) */
const matchesFilter = (name: string, filter: string): boolean => {
  if (!filter) return true
  const lowerName = name.toLowerCase()
  const lowerFilter = filter.toLowerCase()
  // Support fuzzy matching: each character in filter should appear in order in name
  let filterIndex = 0
  for (const char of lowerName) {
    if (char === lowerFilter[filterIndex]) {
      filterIndex++
      if (filterIndex === lowerFilter.length) return true
    }
  }
  return filterIndex === lowerFilter.length
}

/** Highlight matching characters in name */
const HighlightedName = ({ name, filter }: { name: string; filter: string }): JSX.Element => {
  if (!filter) return <span className="dshx:truncate">{name}</span>
  
  const lowerName = name.toLowerCase()
  const lowerFilter = filter.toLowerCase()
  const highlights: boolean[] = new Array(name.length).fill(false)
  
  let filterIndex = 0
  for (let i = 0; i < lowerName.length && filterIndex < lowerFilter.length; i++) {
    if (lowerName[i] === lowerFilter[filterIndex]) {
      highlights[i] = true
      filterIndex++
    }
  }
  
  return (
    <span className="dshx:truncate">
      {name.split('').map((char, i) => (
        <span key={i} className={highlights[i] ? 'dshx:text-primary dshx:font-semibold' : undefined}>
          {char}
        </span>
      ))}
    </span>
  )
}

/**
 * One lazily listed directory; children are fetched only while it is expanded, and relisted on Host `changes` frames
 * for as long as it stays expanded (collapsing aborts the watch).
 */
const Directory = (props: TreeProps & { readonly path: string; readonly depth: number }): JSX.Element => {
  const filter = props.filter ?? ''
  const isFiltering = filter.length > 0
  const [manualExpanded, setManualExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const queryClient = useQueryClient()
  const queryKey = ['dshfiles-editor', 'list', props.sessionId, props.path]
  
  useEffect(() => {
    const controller = new AbortController()
    const watchPath = props.path === '' ? '.' : props.path
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const invalidate = (): void => {
      flushTimer = undefined
      void queryClient.invalidateQueries({ queryKey: ['dshfiles-editor', 'list', props.sessionId, props.path], exact: true })
    }
    void (async () => {
      try {
        for await (const frame of props.remote.workspaceFiles.changes(props.sessionId, watchPath, controller.signal)) {
          // Frames inside the open window coalesce into the one invalidation that fires when it closes.
          if (frame.kind !== 'change' || flushTimer !== undefined) continue
          flushTimer = setTimeout(invalidate, DIRECTORY_INVALIDATION_MS)
        }
      } catch {
        // No watch (unsupported, or the Host dropped it): the Refresh button and staleTime still apply.
      }
    })()
    return () => {
      controller.abort()
      if (flushTimer !== undefined) clearTimeout(flushTimer)
    }
  }, [props.remote, props.sessionId, props.path, queryClient])
  
  const listing = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await props.remote.workspaceFiles.list(props.sessionId, props.path === '' ? '.' : props.path, signal)
      if (!result.ok) throw result.error
      return result.value
    },
    staleTime: 5_000,
  })
  
  const filteredEntries = useMemo(() => {
    if (!listing.data) return []
    const entries = [...listing.data.entries].sort((left, right) => {
      if (left.type === right.type) return left.name.localeCompare(right.name)
      if (left.type === 'directory') return -1
      if (right.type === 'directory') return 1
      return 0
    })
    if (!isFiltering) return entries
    // When filtering, show all entries that match (directories are always shown to allow nested matches)
    return entries.filter(entry => entry.type === 'directory' || matchesFilter(entry.name, filter))
  }, [listing.data, filter, isFiltering])
  
  if (listing.isPending) return <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">Loading…</p>
  if (listing.isError) return <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-destructive">{listing.error.message}</p>
  
  return (
    <ul role="group">
      {filteredEntries.map(entry => {
        const path = props.path === '' ? entry.name : props.path + '/' + entry.name
        const indent = { paddingLeft: 4 + props.depth * 12 }
        if (entry.type === 'directory') {
          // When filtering, auto-expand directories
          const open = isFiltering || manualExpanded.has(entry.name)
          return (
            <li aria-expanded={open} key={entry.name} role="treeitem">
              <button
                className={ROW}
                onClick={() =>
                  setManualExpanded(current => {
                    const next = new Set(current)
                    if (open && !isFiltering) next.delete(entry.name)
                    else next.add(entry.name)
                    return next
                  })
                }
                style={indent}
                type="button"
              >
                <ChevronRightIcon className={cn('dshx:size-3 dshx:flex-none dshx:transition-transform', open && 'dshx:rotate-90')} />
                <FolderIcon className="dshx:size-3.5 dshx:flex-none dshx:text-muted-foreground" />
                <HighlightedName name={entry.name} filter={filter} />
              </button>
              {open && <Directory {...props} depth={props.depth + 1} path={path} />}
            </li>
          )
        }
        return (
          <li key={entry.name} role="treeitem">
            <button
              className={cn(ROW, props.activePath === path && 'dshx:bg-accent dshx:font-medium')}
              disabled={entry.type !== 'file'}
              onClick={() => props.onOpen(path)}
              style={{ paddingLeft: 4 + props.depth * 12 + 16 }}
              title={path}
              type="button"
            >
              <FileIcon className="dshx:size-3.5 dshx:flex-none dshx:text-muted-foreground" />
              <HighlightedName name={entry.name} filter={filter} />
            </button>
          </li>
        )
      })}
      {listing.data.truncated && <li className="dshx:px-2 dshx:text-2xs dshx:text-muted-foreground">More entries not shown.</li>}
    </ul>
  )
}

export const FileTree = (props: TreeProps): JSX.Element => (
  <div aria-label="Workspace files" className="dshx:overflow-auto dshx:py-1" role="tree">
    <Directory {...props} depth={0} path="" />
  </div>
)
