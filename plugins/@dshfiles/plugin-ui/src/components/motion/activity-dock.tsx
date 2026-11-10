import * as React from 'react'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { GitBranchIcon, ArrowUpRightIcon } from '../../icons.js'

export interface DockFileChange {
  readonly path: string
  readonly added: number
  readonly removed: number
  /** Opens this file; without it the row is plain text. */
  readonly onOpen?: () => void
}

export interface DockChangeGroup {
  readonly id: string
  readonly label: string
  readonly icon?: React.ReactNode
  readonly hint?: string
  readonly name?: string
  readonly branch?: string
  readonly files: readonly DockFileChange[]
  /** Files not listed ("+1 more in this source"). */
  readonly more?: number
  readonly onOpenBranch?: () => void
}

/** Changed files grouped by destination for a dock panel; rows rise in with a stagger. */
export function DockChanges({ groups, className }: { readonly groups: readonly DockChangeGroup[]; readonly className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  useEnter(ref, 'riseIn', { children: true, stagger: 0.05 })
  return (
    <div ref={ref} className={cn('dshx:flex dshx:flex-col dshx:gap-4', className)}>
      {groups.map(group => (
        <div key={group.id} className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:text-sm">
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground dshx:[&_svg]:size-3.5">
            {group.icon}
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-medium">{group.label}</span>
            <span className="dshx:shrink-0 dshx:text-xs">{fileCount(group.files.length + (group.more ?? 0))}</span>
          </div>
          {group.hint ? <p className="dshx:text-xs dshx:text-muted-foreground">{group.hint}</p> : null}
          {group.name ? <span className="dshx:mt-1 dshx:truncate dshx:font-semibold dshx:text-foreground">{group.name}</span> : null}
          {group.branch ? (
            <button
              type="button"
              onClick={group.onOpenBranch}
              className="dshx:flex dshx:w-fit dshx:max-w-full dshx:items-center dshx:gap-1.5 dshx:rounded-sm dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:[&_svg]:size-3"
            >
              <GitBranchIcon aria-hidden />
              <span className="dshx:min-w-0 dshx:truncate">{group.branch}</span>
              <ArrowUpRightIcon aria-hidden />
            </button>
          ) : null}
          <ul className="dshx:mt-1 dshx:flex dshx:flex-col dshx:gap-1">
            {group.files.map(file => (
              <ChangeFileRow file={file} key={file.path} />
            ))}
            {group.more ? <li className="dshx:pl-6 dshx:text-xs dshx:text-muted-foreground">+{group.more} more in this source</li> : null}
          </ul>
        </div>
      ))}
    </div>
  )
}

const ChangeFileRow = ({ file }: { readonly file: DockFileChange }) => {
  const row = (
    <>
      <span
        aria-hidden
        className="dshx:grid dshx:h-4 dshx:shrink-0 dshx:place-items-center dshx:rounded-[3px] dshx:bg-info/15 dshx:px-0.5 dshx:font-mono dshx:text-[9px] dshx:font-semibold dshx:text-info"
      >
        {extension(file.path)}
      </span>
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-foreground">{file.path}</span>
      <span className="dshx:shrink-0 dshx:font-mono dshx:text-xs dshx:tabular-nums">
        {file.added > 0 ? <span className="dshx:text-success">+{file.added}</span> : null}
        {file.added > 0 && file.removed > 0 ? ' ' : null}
        {file.removed > 0 ? <span className="dshx:text-destructive">−{file.removed}</span> : null}
      </span>
    </>
  )
  const className = 'dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2'
  return (
    <li className="dshx:flex dshx:min-w-0">
      {file.onOpen === undefined ? (
        <div className={className}>{row}</div>
      ) : (
        <button
          aria-label={`Open ${file.path}`}
          className={cn(
            className,
            'dshx:rounded-sm dshx:text-left dshx:outline-none dshx:hover:bg-muted/50 dshx:hover:[&>span:nth-child(2)]:underline dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
          )}
          onClick={file.onOpen}
          type="button"
        >
          {row}
        </button>
      )}
    </li>
  )
}

const fileCount = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`

const extension = (path: string) => (path.split('.').pop() ?? '').slice(0, 3).toUpperCase()
