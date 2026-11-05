import * as React from 'react'
import { animate, motionSafe, presets, springs, staggers } from '../../motion/index.js'
import { Button } from '../ui/button.js'
import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { PresenceList } from './presence-list.js'
import { RollingNumber, ShimmerText } from './text.js'
import { LaneGraphCell, laneChip, laneFill, laneStroke, layoutLaneGraph, toneForLane, type LaneGraphEdge, type LaneTone } from './lane-graph.js'

export type MergeTargetStatus = 'checking' | 'conflicts' | 'resolving' | 'resolved' | 'ready' | 'merged'

export interface MergeRevision {
  readonly id: string
  readonly title: string
  /** Bookmark / branch shown as a chip after the title. */
  readonly bookmark?: string
  readonly hash: string
  readonly author?: string
  readonly age?: string
  readonly lane: number
  /** Parent revision ids (lower rows). */
  readonly parents: readonly string[]
  readonly tone?: LaneTone
  /** Someone else's revision or trunk history: drawn quieter. */
  readonly muted?: boolean
  /** Conflicting hunks this revision brings, shown as a warning count until `resolved`; `true` when only the fact is known. */
  readonly conflicts?: number | true | undefined
  readonly resolved?: boolean
  /** `working` spins (a merge being made), `ring` is a hollow node (not yet committed). */
  readonly node?: 'dot' | 'ring' | 'working'
  /** A running job on this revision (tests after a merge): replaces hash/author with `done/total` and an underline. */
  readonly progress?: { readonly done: number; readonly total: number }
}

export interface MergeConflictGraphProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  /** Change or PR number, e.g. "#128". */
  readonly number?: string
  /** `null` hides the state badge. */
  readonly state?: { readonly label: string; readonly tone: 'success' | 'muted' | 'violet' | 'info' } | null
  /** The landing target row at the top ("Merge into main"). */
  readonly target: { readonly label: string; readonly status: MergeTargetStatus; readonly conflicts?: number }
  /** Revisions newest first. */
  readonly revisions: readonly MergeRevision[]
  /** Live line in the footer while resolving ("Running 42 of 42 tests"). */
  readonly statusText?: string
  readonly onResolve?: () => void
  /** Replaces the default footer (e.g. a MergeChecks block); `null` renders none. */
  readonly footer?: React.ReactNode
}

const TARGET_ID = '__merge-target'
const stateDot = { success: 'dshx:bg-success', muted: 'dshx:bg-muted-foreground', violet: 'dshx:bg-violet', info: 'dshx:bg-info' } as const
const stateText = { success: 'dshx:text-success', muted: 'dshx:text-muted-foreground', violet: 'dshx:text-violet', info: 'dshx:text-info' } as const

/**
 * A branch about to land, drawn as a compact commit graph: the target row on top, the branch's revisions with their
 * lanes, conflicting revisions flagged in amber with a hunk count that flips to a check as each one resolves, and a
 * merge revision that slides in with a test-progress underline. Rows draw their lane segments top-down on mount and
 * glide (FLIP) when revisions are inserted.
 */
export function MergeConflictGraph({
  heading,
  number,
  state = { label: 'Open', tone: 'success' },
  target,
  revisions,
  statusText,
  onResolve,
  footer,
  className,
  ...props
}: MergeConflictGraphProps) {
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
  }, [])

  const targetTone: LaneTone = target.status === 'ready' || target.status === 'merged' ? 'success' : target.status === 'checking' ? 'muted' : 'warning'
  const rows = [{ id: TARGET_ID, lane: 0 }, ...revisions.map(revision => ({ id: revision.id, lane: revision.lane }))]
  const edges: LaneGraphEdge[] = []
  const first = revisions[0]
  if (first !== undefined) edges.push({ from: TARGET_ID, to: first.id, dashed: true, tone: targetTone, bend: 'upper' })
  for (const revision of revisions) {
    revision.parents.forEach((parent, order) => {
      const other = revisions.find(candidate => candidate.id === parent)
      const lane = Math.max(revision.lane, other?.lane ?? 0)
      const owner = revision.lane >= (other?.lane ?? 0) ? revision : other
      // A merge's second parent leaves the merge node at once, so it never runs through the first parent's lane.
      const tone = owner?.tone ?? toneForLane(lane)
      edges.push(order > 0 ? { from: revision.id, to: parent, tone, bend: 'upper' } : { from: revision.id, to: parent, tone })
    })
  }
  const layout = layoutLaneGraph(rows, edges)
  const delay = (index: number) => (mounted.current ? 0 : 0.08 + index * staggers.base)

  const items = [
    {
      key: TARGET_ID,
      node: <TargetRow layout={layout} target={target} delay={delay(0)} />,
    },
    ...revisions.map((revision, index) => ({
      key: revision.id,
      node: <RevisionRow layout={layout} revision={revision} delay={delay(index + 1)} />,
    })),
  ]

  return (
    <section
      aria-label={`${heading}${number ? ` ${number}` : ''}`}
      className={cn(
        'dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-3 dshx:text-card-foreground',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-1">
        <h3 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-semibold dshx:@max-pane-narrow:line-clamp-2 dshx:@max-pane-narrow:whitespace-normal">
          {heading}
          {number ? <span className="dshx:ml-1 dshx:font-normal dshx:text-muted-foreground">{number}</span> : null}
        </h3>
        {state === null ? null : (
          <span className={cn('dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-xs', stateText[state.tone])}>
            <span className={cn('dshx:size-1.5 dshx:rounded-full', stateDot[state.tone])} />
            {state.label}
          </span>
        )}
      </header>
      <PresenceList
        as="ul"
        aria-label="Revisions"
        className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:p-0"
        items={items}
        enter={null}
        itemClassName="dshx:relative"
      />
      {footer === undefined ? <DefaultFooter target={target} statusText={statusText} onResolve={onResolve} /> : footer}
    </section>
  )
}

function useRowEnter(delay: number) {
  const ref = React.useRef<HTMLDivElement>(null)
  // The slide-in plays once, with the delay of the row's first render.
  const enterDelay = React.useRef(delay)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, presets.slideInLeft, motionSafe({ ...springs.smooth, delay: enterDelay.current }))
    return () => controls.complete()
  }, [])
  return ref
}

/** Swap animation for a keyed glyph: pops in with a bounce whenever `swapKey` changes. */
function Pop({ swapKey, className, children }: { readonly swapKey: string; readonly className?: string; readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (ref.current == null) return
    const controls = animate(ref.current, { opacity: [0, 1], transform: ['scale(0.4)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [swapKey])
  return (
    <span ref={ref} className={cn('dshx:inline-flex dshx:items-center dshx:justify-center', className)}>
      {children}
    </span>
  )
}

const targetLabel = {
  checking: 'checking',
  conflicts: 'conflicts',
  resolving: 'resolving',
  resolved: 'resolved',
  ready: 'ready',
  merged: 'merged',
} as const satisfies Record<MergeTargetStatus, string>

function TargetRow({
  layout,
  target,
  delay,
}: {
  readonly layout: ReturnType<typeof layoutLaneGraph>
  readonly target: MergeConflictGraphProps['target']
  readonly delay: number
}) {
  const ref = useRowEnter(delay)
  const ok = target.status === 'ready' || target.status === 'merged'
  const node =
    target.status === 'checking' ? (
      <LoaderCircleIcon className="dshx:size-3.5 dshx:animate-spin dshx:rounded-full dshx:bg-card dshx:text-muted-foreground dshx:motion-reduce:animate-none" />
    ) : ok ? (
      <span className="dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-success dshx:text-background">
        <CheckIcon className="dshx:size-2.5" strokeWidth={3.5} />
      </span>
    ) : (
      <span className="dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-warning dshx:text-[9px] dshx:font-bold dshx:text-background">
        !
      </span>
    )
  const label =
    target.status === 'conflicts' && target.conflicts !== undefined ? (
      <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
        <RollingNumber value={target.conflicts} /> {target.conflicts === 1 ? 'conflict' : 'conflicts'}
      </span>
    ) : target.status === 'resolving' || target.status === 'checking' ? (
      <ShimmerText>{targetLabel[target.status]}</ShimmerText>
    ) : (
      targetLabel[target.status]
    )
  return (
    <div ref={ref} className="dshx:flex dshx:h-7 dshx:items-center dshx:gap-2 dshx:px-1">
      <LaneGraphCell
        layout={layout}
        rowId={TARGET_ID}
        lane={0}
        node={<Pop swapKey={ok ? 'ok' : target.status === 'checking' ? 'wait' : 'warn'}>{node}</Pop>}
        drawDelay={delay + 0.1}
      />
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:text-muted-foreground">{target.label}</span>
      <span
        aria-live="polite"
        className={cn(
          'dshx:shrink-0 dshx:text-xs dshx:transition-colors',
          ok ? 'dshx:text-success' : target.status === 'checking' ? 'dshx:text-muted-foreground' : 'dshx:text-warning',
        )}
      >
        <Pop swapKey={target.status}>{label}</Pop>
      </span>
    </div>
  )
}

function RevisionRow({
  layout,
  revision,
  delay,
}: {
  readonly layout: ReturnType<typeof layoutLaneGraph>
  readonly revision: MergeRevision
  readonly delay: number
}) {
  const ref = useRowEnter(delay)
  const underline = React.useRef<HTMLSpanElement>(null)
  const tone = revision.tone ?? toneForLane(revision.lane)
  const hasConflicts = revision.conflicts === true || (revision.conflicts ?? 0) > 0
  const conflicted = hasConflicts && revision.resolved !== true
  const fraction = revision.progress ? Math.min(1, revision.progress.done / Math.max(1, revision.progress.total)) : 0
  React.useLayoutEffect(() => {
    if (underline.current == null) return
    const controls = animate(underline.current, { transform: `scaleX(${fraction})` }, motionSafe(springs.smooth))
    return () => controls.stop()
  }, [fraction])

  const kind = revision.node ?? 'dot'
  const node =
    kind === 'working' ? (
      <LoaderCircleIcon className={cn('dshx:size-3 dshx:animate-spin dshx:rounded-full dshx:bg-card dshx:motion-reduce:animate-none', laneStroke[tone])} />
    ) : kind === 'ring' ? (
      <span className={cn('dshx:size-2.5 dshx:rounded-full dshx:border-[1.5px] dshx:border-current dshx:bg-card', laneStroke[tone])} />
    ) : (
      <span
        className={cn('dshx:size-2 dshx:rounded-full dshx:ring-2 dshx:ring-card dshx:transition-colors', conflicted ? 'dshx:bg-warning' : laneFill[tone])}
      />
    )

  return (
    <div ref={ref} className="dshx:relative dshx:flex dshx:h-7 dshx:items-center dshx:gap-2 dshx:px-1">
      <LaneGraphCell layout={layout} rowId={revision.id} lane={revision.lane} node={<Pop swapKey={kind}>{node}</Pop>} drawDelay={delay + 0.1} />
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5">
        <span
          className={cn(
            'dshx:min-w-0 dshx:truncate dshx:text-sm dshx:transition-colors dshx:duration-300',
            conflicted ? 'dshx:text-warning' : revision.muted ? 'dshx:text-muted-foreground' : 'dshx:text-foreground',
          )}
        >
          {revision.title}
        </span>
        {revision.bookmark ? (
          <span
            className={cn(
              'dshx:shrink-0 dshx:rounded dshx:px-1 dshx:py-px dshx:font-mono dshx:text-[10.5px] dshx:@max-pane-narrow:hidden',
              revision.muted ? laneChip.muted : laneChip[tone],
            )}
          >
            {revision.bookmark}
          </span>
        ) : null}
        {hasConflicts ? (
          <Pop swapKey={conflicted ? 'open' : 'done'} className="dshx:shrink-0">
            {conflicted ? (
              revision.conflicts === true ? (
                <TriangleAlertIcon role="img" aria-label="Conflict" className="dshx:size-3.5 dshx:text-warning" />
              ) : (
                <span
                  className="dshx:rounded dshx:bg-warning/15 dshx:px-1 dshx:text-[10.5px] dshx:font-medium dshx:text-warning"
                  aria-label={`${revision.conflicts} conflicts`}
                >
                  {revision.conflicts}
                </span>
              )
            ) : (
              <span
                className="dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center dshx:rounded-full dshx:border dshx:border-success/50 dshx:text-success"
                aria-label="Resolved"
              >
                <CheckIcon className="dshx:size-2.5" strokeWidth={3} />
              </span>
            )}
          </Pop>
        ) : null}
      </span>
      {revision.progress ? (
        <span className="dshx:shrink-0 dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
          <RollingNumber value={revision.progress.done} />/{revision.progress.total}
        </span>
      ) : (
        <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
          <span className="dshx:font-mono dshx:text-[11px] dshx:@max-pane-narrow:hidden">{revision.hash}</span>
          {revision.author || revision.age ? (
            <span>
              {revision.author ? (
                <span className="dshx:@max-pane-narrow:hidden">
                  {revision.author}
                  {revision.age ? ' · ' : ''}
                </span>
              ) : null}
              {revision.age}
            </span>
          ) : null}
        </span>
      )}
      {revision.progress ? (
        <span
          ref={underline}
          aria-hidden
          className={cn(
            'dshx:absolute dshx:right-1 dshx:bottom-0 dshx:h-[2px] dshx:origin-left dshx:rounded-full',
            fraction >= 1 ? 'dshx:bg-success' : 'dshx:bg-info',
          )}
          style={{ left: layout.lanes * layout.geometry.laneWidth + 12, transform: 'scaleX(0)' }}
        />
      ) : null}
    </div>
  )
}

function DefaultFooter({
  target,
  statusText,
  onResolve,
}: {
  readonly target: MergeConflictGraphProps['target']
  readonly statusText: string | undefined
  readonly onResolve: (() => void) | undefined
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, presets.blurIn, motionSafe({ duration: 0.3 }))
    return () => controls.complete()
  }, [target.status])
  const resolving = target.status === 'resolving'
  return (
    <footer
      ref={ref}
      aria-live="polite"
      className="dshx:flex dshx:min-h-8 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:border-border/60 dshx:px-1 dshx:pt-2 dshx:text-sm"
    >
      {target.status === 'conflicts' ? (
        <>
          <TriangleAlertIcon className="dshx:size-3.5 dshx:shrink-0 dshx:text-warning" />
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:@max-pane-narrow:min-w-[12rem]">
            <span className="dshx:text-warning">
              {target.conflicts ?? 0} {target.conflicts === 1 ? 'conflict' : 'conflicts'}
            </span>{' '}
            <span className="dshx:text-muted-foreground">with main</span>
          </span>
        </>
      ) : resolving || target.status === 'checking' ? (
        <>
          <LoaderCircleIcon className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin dshx:text-muted-foreground dshx:motion-reduce:animate-none" />
          <ShimmerText className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:@max-pane-narrow:min-w-[12rem]">
            {statusText ?? 'Merging main into the branch'}
          </ShimmerText>
        </>
      ) : (
        <>
          <CheckIcon className="dshx:size-3.5 dshx:shrink-0 dshx:text-success" />
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-muted-foreground">{statusText ?? 'No conflicts with main'}</span>
        </>
      )}
      {target.status === 'conflicts' || resolving ? (
        <Button
          size="sm"
          variant="secondary"
          className="dshx:ml-auto dshx:shrink dshx:rounded-full dshx:bg-info/12 dshx:text-info dshx:hover:bg-info/20"
          disabled={resolving}
          onClick={onResolve}
        >
          {resolving ? <LoaderCircleIcon className="dshx:animate-spin dshx:motion-reduce:animate-none" /> : null}
          {resolving ? 'Resolving' : 'Resolve conflicts'}
        </Button>
      ) : null}
    </footer>
  )
}
