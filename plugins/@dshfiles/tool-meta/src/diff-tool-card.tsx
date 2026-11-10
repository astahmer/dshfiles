import { FilePath } from '@dshfiles/plugin-ui/components/code-block'
import { ToolCard, type ToolStatus } from '@dshfiles/plugin-ui/components/tool-card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { PatchView } from '@dshfiles/plugin-ui/diff'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'
import { hunkDiffs, hunkTotals, type HunkDiff } from './file-hunk-diff.js'
import { FileToolModels, type FileHunk, type FileToolCall } from './file-tool-models.js'

/** The Host conversation labels this card borrows, so a zh profile reads it like the native rows. */
export type DiffTranslate = (
  key: 'tool.title.edit' | 'tool.title.write' | 'diff.expandAria' | 'diff.collapseAria',
  params?: Record<string, string | number>,
) => string

export interface DiffToolCardProps {
  /** The call material the models read; the slot owner props satisfy it. */
  readonly call: FileToolCall
  readonly useDisclosure: () => { readonly expanded: boolean; readonly setExpanded: (open: boolean) => void; readonly toggle: () => void }
  readonly t: DiffTranslate
  /** The native `edit` / `write` row, rendered whenever this card has nothing better, or is missing off. */
  readonly native: ReactNode
}

/** ToolCard's `title` is the card's visible label, not hover help: it rides a props object so the native-title rule stays about hover help. */
const cardLabel = (title: string) => ({ title })

/** What a file-mutation call shows: its title, the file, the hunks it applied and how it ended. */
interface AppliedDiff {
  readonly status: ToolStatus
  readonly title: string
  readonly path?: string | undefined
  readonly hunks: readonly FileHunk[]
  readonly error?: string | undefined
}

/**
 * The hunks of a settled `edit` / `write`, or every stage of an `apply_patch` call — which has no native card of its
 * own, so this one never declines. A running or failed file-mutation call stays the native row where DSH has one.
 */
const appliedDiff = (props: DiffToolCardProps): AppliedDiff | undefined => {
  if (props.call.phase === 'preparing') return undefined
  if (props.call.toolName === 'apply_patch') {
    const call = FileToolModels.patchCall(props.call)
    if (call.status === 'failed') return { status: 'failed', title: props.call.toolName, path: call.path, hunks: [], error: call.error }
    if (call.status === 'running') return { status: 'running', title: props.call.toolName, path: call.path, hunks: call.hunks ?? [] }
    return { status: 'passed', title: props.call.toolName, path: call.path, hunks: call.hunks }
  }
  const hunks = FileToolModels.nativeHunks(props.call)
  if (hunks === undefined) return undefined
  return {
    status: 'passed',
    title: props.call.toolName === 'write' ? props.t('tool.title.write') : props.t('tool.title.edit'),
    path: hunks[0]?.path,
    hunks,
  }
}

const HunkRow = (props: {
  readonly entry: HunkDiff
  readonly showPath: boolean
  readonly open: boolean
  readonly onToggle: (open: boolean) => void
  readonly t: DiffTranslate
}): JSX.Element => (
  <Collapsible className="dshx:min-w-0" onOpenChange={props.onToggle} open={props.open}>
    <CollapsibleTrigger
      aria-label={props.open ? props.t('diff.collapseAria') : props.t('diff.expandAria')}
      className="dshx:flex dshx:w-full dshx:items-center dshx:gap-1.5 dshx:px-3 dshx:py-1 dshx:text-xs dshx:text-muted-foreground dshx:hover:text-foreground"
    >
      <ChevronRightIcon className={cn('dshx:size-3 dshx:transition-transform', props.open && 'dshx:rotate-90')} />
      <span className="dshx:shrink-0 dshx:font-mono dshx:tabular-nums">
        <span className="dshx:text-success">+{props.entry.added}</span> <span className="dshx:text-destructive">−{props.entry.removed}</span>
      </span>
      {props.showPath && <FilePath path={props.entry.hunk.path} />}
    </CollapsibleTrigger>
    <CollapsibleContent>
      <PatchView className="dshx:max-h-80 dshx:min-w-0 dshx:rounded-md dshx:border" files={[props.entry.diff]} />
    </CollapsibleContent>
  </Collapsible>
)

/**
 * A file mutation in the shared `PatchView`: one card header with the added/removed totals, and one collapsible unified
 * diff per reported hunk, so a multi-hunk `apply_patch` stays scannable. The card starts closed; the hunks inside it
 * start open.
 */
export const DiffToolCard = (props: DiffToolCardProps): ReactNode => {
  const applied = appliedDiff(props)
  const disclosure = props.useDisclosure()
  const hunks = applied?.hunks ?? []
  const diffs = hunkDiffs(hunks)
  const [closedHunks, setClosedHunks] = useState<ReadonlySet<number>>(() => new Set())
  if (applied === undefined) return props.native
  const totals = hunkTotals(diffs)
  const paths = new Set(diffs.map(entry => entry.hunk.path))
  const toggleHunk = (index: number) => (open: boolean) =>
    setClosedHunks(previous => {
      const next = new Set(previous)
      if (open) next.delete(index)
      else next.add(index)
      return next
    })
  return (
    <ToolCard
      {...cardLabel(applied.title)}
      meta={`+${totals.added} −${totals.removed}`}
      onToggle={disclosure.toggle}
      open={disclosure.expanded}
      status={applied.status}
      summary={applied.path === undefined ? undefined : <FilePath path={applied.path} />}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:pb-1">
        {applied.error !== undefined && (
          <p className="dshx:m-0 dshx:px-3 dshx:py-1 dshx:text-xs dshx:whitespace-pre-wrap dshx:text-destructive">{applied.error}</p>
        )}
        {diffs.map((entry, index) => (
          <HunkRow entry={entry} key={index} onToggle={toggleHunk(index)} open={!closedHunks.has(index)} showPath={paths.size > 1} t={props.t} />
        ))}
      </div>
    </ToolCard>
  )
}
