import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMemo } from 'react'
import type { Revision } from './api.js'
import { RevisionGraphModel } from './graph.js'
import { GRAPH_DENSITY, graphWidthFor, RevisionGraphCell } from './revision-graph-cell.js'

const METRICS = GRAPH_DENSITY.compact

const chipClass = 'dshx:inline-flex dshx:h-4 dshx:shrink-0 dshx:items-center dshx:rounded-sm dshx:px-1 dshx:font-mono! dshx:text-[10px] dshx:leading-none'

/**
 * The chat reference preview drawn like the Jujutsu panel's graph, reduced to what a glance needs: lanes, the change
 * id, bookmark and workspace labels, and the first description line. Elided history between two listed rows stays
 * one dashed lane because the Host sends the revisions joining them.
 */
export const ReferenceGraphView = (props: {
  readonly revisions: readonly Revision[]
  readonly listedCommitIds: readonly string[]
  readonly referencedCommitId: string | null
  readonly defaultCommitId: string | null
}): JSX.Element => {
  const { rows, revisionsById } = useMemo(() => {
    const byId = new Map(props.revisions.map(revision => [revision.commitId, revision]))
    const listed = props.listedCommitIds.flatMap(commitId => {
      const revision = byId.get(commitId)
      return revision === undefined ? [] : [revision]
    })
    return { rows: RevisionGraphModel.layoutRevisionGraph(listed, byId, false), revisionsById: byId }
  }, [props.listedCommitIds, props.revisions])
  const width = graphWidthFor(METRICS, Math.max(1, ...rows.map(row => row.laneCount)))

  return (
    <TooltipProvider delayDuration={500}>
      <ol aria-label="Revision graph" className="dshx:max-h-80 dshx:overflow-auto dshx:py-0.5">
        {rows.map(layout => {
          const revision = revisionsById.get(layout.commitId)
          if (revision === undefined) return null
          const referenced = revision.commitId === props.referencedCommitId
          const title = revision.description.trim()
          return (
            <li
              aria-current={referenced ? 'true' : undefined}
              className={cn(
                'dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:pr-1.5 dshx:text-xs',
                referenced && 'dshx:bg-accent dshx:text-accent-foreground',
                revision.immutable && !referenced && 'dshx:text-muted-foreground',
              )}
              key={revision.commitId}
              style={{ height: METRICS.rowHeight }}
            >
              <RevisionGraphCell height={METRICS.rowHeight} layout={layout} metrics={METRICS} revision={revision} width={width} />
              <code className={cn('dshx:shrink-0 dshx:font-mono! dshx:text-[11px]', referenced ? 'dshx:font-semibold' : 'dshx:text-muted-foreground')}>
                {revision.shortestChangeId}
              </code>
              {revision.workingCopy ? <span className={cn(chipClass, 'dshx:bg-info/15 dshx:text-info')}>@</span> : null}
              {revision.commitId === props.defaultCommitId ? <span className={cn(chipClass, 'dshx:bg-muted dshx:text-muted-foreground')}>default@</span> : null}
              {revision.bookmarks.slice(0, 3).map(bookmark => (
                <Tooltip key={bookmark}>
                  <TooltipTrigger asChild>
                    <span className={cn(chipClass, 'dshx:max-w-28 dshx:truncate dshx:bg-success/15 dshx:text-success')}>{bookmark}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{bookmark}</TooltipContent>
                </Tooltip>
              ))}
              {revision.bookmarks.length > 3 ? (
                <span className="dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground">+{revision.bookmarks.length - 3}</span>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn('dshx:min-w-0 dshx:truncate', title.length === 0 && 'dshx:italic dshx:text-muted-foreground')}>
                    {title.length > 0 ? title : revision.empty ? '(empty) no description' : 'no description'}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{title.length > 0 ? title : revision.empty ? '(empty) no description' : 'no description'}</TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ol>
    </TooltipProvider>
  )
}
