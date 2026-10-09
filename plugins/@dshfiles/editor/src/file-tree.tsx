import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChevronRightIcon, FileIcon, FolderIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

interface TreeProps {
  readonly remote: Pick<ClientRemote, 'workspaceFiles'>
  readonly sessionId: SessionId
  readonly activePath: string | null
  readonly onOpen: (path: string) => void
}

const ROW =
  'dshx:flex dshx:h-6 dshx:w-full dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:pr-1 dshx:text-left dshx:text-xs dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

/** One lazily listed directory; children are fetched only while it is expanded. */
const Directory = (props: TreeProps & { readonly path: string; readonly depth: number }): JSX.Element => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const listing = useQuery({
    queryKey: ['dshfiles-editor', 'list', props.sessionId, props.path],
    queryFn: async ({ signal }) => {
      const result = await props.remote.workspaceFiles.list(props.sessionId, props.path === '' ? '.' : props.path, signal)
      if (!result.ok) throw result.error
      return result.value
    },
    staleTime: 5_000,
  })
  if (listing.isPending) return <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">Loading…</p>
  if (listing.isError) return <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-destructive">{listing.error.message}</p>
  const entries = [...listing.data.entries].sort((left, right) =>
    left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'directory' ? -1 : right.type === 'directory' ? 1 : 0,
  )
  return (
    <ul role="group">
      {entries.map(entry => {
        const path = props.path === '' ? entry.name : props.path + '/' + entry.name
        const indent = { paddingLeft: 4 + props.depth * 12 }
        if (entry.type === 'directory') {
          const open = expanded.has(entry.name)
          return (
            <li aria-expanded={open} key={entry.name} role="treeitem">
              <button
                className={ROW}
                onClick={() =>
                  setExpanded(current => {
                    const next = new Set(current)
                    if (open) next.delete(entry.name)
                    else next.add(entry.name)
                    return next
                  })
                }
                style={indent}
                type="button"
              >
                <ChevronRightIcon className={cn('dshx:size-3 dshx:flex-none dshx:transition-transform', open && 'dshx:rotate-90')} />
                <FolderIcon className="dshx:size-3.5 dshx:flex-none dshx:text-muted-foreground" />
                <span className="dshx:truncate">{entry.name}</span>
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
              <span className="dshx:truncate">{entry.name}</span>
            </button>
          </li>
        )
      })}
      {listing.data.truncated && <li className="dshx:px-2 dshx:text-[11px] dshx:text-muted-foreground">More entries not shown.</li>}
    </ul>
  )
}

export const FileTree = (props: TreeProps): JSX.Element => (
  <div aria-label="Workspace files" className="dshx:overflow-auto dshx:py-1" role="tree">
    <Directory {...props} depth={0} path="" />
  </div>
)
