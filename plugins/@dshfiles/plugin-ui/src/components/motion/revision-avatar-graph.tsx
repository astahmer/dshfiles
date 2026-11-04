import * as React from 'react'
import { animate, motionSafe, presets, springs, staggers, type AnimationPlaybackControls } from '../../motion/index.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js'
import { CheckIcon, ChevronDownIcon, FolderIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { PresenceList } from './presence-list.js'
import { RollingNumber } from './text.js'
import { LaneGraphCell, laneFill, laneRing, layoutLaneGraph, toneForLane, type LaneGraphEdge, type LaneTone } from './lane-graph.js'

export interface AvatarRevision {
  readonly kind?: 'revision'
  readonly id: string
  readonly message: string
  readonly hash: string
  readonly age: string
  readonly author: { readonly name: string; readonly initials?: string }
  readonly lane: number
  readonly parents: readonly string[]
  readonly tone?: LaneTone
  /** Bookmark pinned in the left column; `current` marks the checked-out one. */
  readonly bookmark?: { readonly name: string; readonly current?: boolean }
  /** Left-column note ("Merged history"). */
  readonly note?: string
}

/** A folded run of revisions ("Commits (617)"); lanes pass straight through it. */
export interface RevisionGap {
  readonly kind: 'gap'
  readonly id: string
  readonly count: number
  readonly lane: number
  readonly label?: string
}

export type AvatarGraphEntry = AvatarRevision | RevisionGap

export interface RevisionAvatarGraphProps extends React.HTMLAttributes<HTMLElement> {
  /** Newest first. */
  readonly entries: readonly AvatarGraphEntry[]
  readonly onExpandGap?: (id: string) => void
  readonly selectedId?: string
  readonly onSelectRevision?: (id: string) => void
}

const ROW = 30
const isGap = (entry: AvatarGraphEntry): entry is RevisionGap => entry.kind === 'gap'
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

/**
 * A revision log where every node is its author's avatar: lanes of the graph in their branch colour, avatars ringed in
 * that colour, bookmarks and "merged history" notes in a left column, and long runs folded into "Commits (n)" rows that
 * unfold in place. Lanes draw top-down and avatars pop in a cascade; unfolding glides the rows below (FLIP) while the
 * new revisions cascade in.
 */
export function RevisionAvatarGraph({ entries, onExpandGap, selectedId, onSelectRevision, className, ...props }: RevisionAvatarGraphProps) {
  const seen = React.useRef<ReadonlySet<string>>(new Set())
  const mounted = React.useRef(false)
  const ids = new Set(entries.map(entry => entry.id))
  const edges: LaneGraphEdge[] = entries.flatMap(entry =>
    isGap(entry)
      ? []
      : entry.parents
          .filter(parent => ids.has(parent))
          .map(parent => {
            const other = entries.find(candidate => candidate.id === parent)
            const lane = Math.max(entry.lane, other?.lane ?? 0)
            const owner = other !== undefined && other.lane > entry.lane && !isGap(other) ? other : entry
            return { from: entry.id, to: parent, tone: (isGap(owner) ? undefined : owner.tone) ?? toneForLane(lane) }
          }),
  )
  const layout = layoutLaneGraph(
    entries.map(entry => ({ id: entry.id, lane: entry.lane })),
    edges,
    { rowHeight: ROW, laneWidth: 26, nodeRadius: 10 },
  )
  let fresh = 0
  const delays = new Map<string, number>()
  for (const entry of entries) if (!seen.current.has(entry.id)) delays.set(entry.id, (mounted.current ? 0 : 0.1) + fresh++ * staggers.base)
  React.useEffect(() => {
    mounted.current = true
    seen.current = new Set(entries.map(entry => entry.id))
  })

  return (
    <TooltipProvider delayDuration={200}>
      <section
        aria-label="Revision graph"
        className={cn('dshx-root dshx:@container dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:py-2 dshx:text-card-foreground', className)}
        {...props}
      >
        <PresenceList
          as="ul"
          enter={null}
          exit="fadeOut"
          className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:p-0"
          items={entries.map(entry => ({
            key: entry.id,
            node: isGap(entry) ? (
              <GapRow gap={entry} layout={layout} delay={delays.get(entry.id) ?? null} onExpand={onExpandGap} />
            ) : (
              <RevisionRow
                revision={entry}
                layout={layout}
                delay={delays.get(entry.id) ?? null}
                selected={selectedId === entry.id}
                onSelect={onSelectRevision}
              />
            ),
          }))}
        />
      </section>
    </TooltipProvider>
  )
}

function useCascade(delay: number | null) {
  const row = React.useRef<HTMLDivElement>(null)
  const avatar = React.useRef<HTMLSpanElement>(null)
  // The cascade plays once, with the delay the row had when it first appeared.
  const enterDelay = React.useRef(delay)
  React.useLayoutEffect(() => {
    const at = enterDelay.current
    if (at === null) return
    const running: AnimationPlaybackControls[] = []
    if (row.current) running.push(animate(row.current, presets.fadeIn, motionSafe({ duration: 0.25, delay: at })))
    if (avatar.current)
      running.push(animate(avatar.current, { opacity: [0, 1], transform: ['scale(0.2)', 'scale(1)'] }, motionSafe({ ...springs.bouncy, delay: at + 0.08 })))
    return () => {
      for (const controls of running) controls.complete()
    }
  }, [])
  return { row, avatar }
}

function LeftColumn({ children }: { readonly children?: React.ReactNode }) {
  return <span className="dshx:flex dshx:w-28 dshx:shrink-0 dshx:items-center dshx:pl-2 dshx:@max-pane-narrow:hidden">{children}</span>
}

function RevisionRow({
  revision,
  layout,
  delay,
  selected,
  onSelect,
}: {
  readonly revision: AvatarRevision
  readonly layout: ReturnType<typeof layoutLaneGraph>
  readonly delay: number | null
  readonly selected: boolean
  readonly onSelect: ((id: string) => void) | undefined
}) {
  const { row, avatar } = useCascade(delay)
  const tone = revision.tone ?? toneForLane(revision.lane)
  // Motion pops the outer span; the hover scale lives on the inner avatar so the two transforms never compound.
  const node = (
    <span ref={avatar} className="dshx:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={-1}
            className={cn(
              'dshx:flex dshx:size-[18px] dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted dshx:text-[8px] dshx:font-semibold dshx:text-foreground dshx:ring-2 dshx:ring-offset-2 dshx:ring-offset-card dshx:transition-transform dshx:duration-200 dshx:group-hover:scale-125',
              laneRing[tone],
            )}
          >
            {revision.author.initials ?? initialsOf(revision.author.name)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{revision.author.name}</TooltipContent>
      </Tooltip>
    </span>
  )
  return (
    <div
      ref={row}
      className={cn('dshx:group dshx:flex dshx:items-center dshx:transition-colors', selected ? 'dshx:bg-accent' : 'dshx:hover:bg-accent/50')}
      style={{ height: ROW }}
    >
      <LeftColumn>
        {revision.bookmark ? (
          <span
            className={cn(
              'dshx:flex dshx:h-5 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1 dshx:rounded dshx:px-1.5 dshx:font-mono dshx:text-[10.5px]',
              revision.bookmark.current ? 'dshx:bg-info/15 dshx:text-info' : 'dshx:bg-muted dshx:text-muted-foreground',
            )}
          >
            {revision.bookmark.current ? <CheckIcon className="dshx:size-3 dshx:shrink-0" /> : null}
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{revision.bookmark.name}</span>
            {revision.bookmark.current ? <FolderIcon className="dshx:size-3 dshx:shrink-0" /> : null}
          </span>
        ) : revision.note ? (
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
            <span className={cn('dshx:size-1.5 dshx:shrink-0 dshx:rounded-full', laneFill[tone])} />
            <span className="dshx:min-w-0 dshx:truncate">{revision.note}</span>
          </span>
        ) : null}
      </LeftColumn>
      <LaneGraphCell
        layout={layout}
        rowId={revision.id}
        lane={revision.lane}
        node={node}
        drawDelay={delay === null ? null : delay + 0.05}
        className="dshx:mx-2"
      />
      <button
        type="button"
        disabled={!onSelect}
        aria-pressed={onSelect ? selected : undefined}
        onClick={() => onSelect?.(revision.id)}
        className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-3 dshx:border-l dshx:border-border/60 dshx:pr-3 dshx:pl-3 dshx:text-left dshx:outline-none dshx:disabled:cursor-default dshx:focus-visible:bg-accent"
      >
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[12.5px] dshx:text-foreground">
          {revision.message}
          <span className="dshx:sr-only"> by {revision.author.name}</span>
        </span>
        <span className="dshx:shrink-0 dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{revision.hash}</span>
        <span className="dshx:w-7 dshx:shrink-0 dshx:text-right dshx:text-[11px] dshx:text-muted-foreground">{revision.age}</span>
      </button>
    </div>
  )
}

function GapRow({
  gap,
  layout,
  delay,
  onExpand,
}: {
  readonly gap: RevisionGap
  readonly layout: ReturnType<typeof layoutLaneGraph>
  readonly delay: number | null
  readonly onExpand: ((id: string) => void) | undefined
}) {
  const { row } = useCascade(delay)
  return (
    <div ref={row} className="dshx:flex dshx:items-center" style={{ height: ROW }}>
      <LeftColumn />
      <LaneGraphCell layout={layout} rowId={gap.id} lane={gap.lane} drawDelay={delay === null ? null : delay + 0.05} className="dshx:mx-2" />
      <button
        type="button"
        disabled={!onExpand}
        onClick={() => onExpand?.(gap.id)}
        aria-label={`Show ${gap.count} folded revisions`}
        className="dshx:group/gap dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1 dshx:border-l dshx:border-border/60 dshx:pr-3 dshx:pl-3 dshx:text-left dshx:text-[11px] dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:text-foreground dshx:disabled:cursor-default"
      >
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
          {gap.label ?? 'Revisions'} (<RollingNumber value={gap.count} />)
        </span>
        <ChevronDownIcon className="dshx:size-3.5 dshx:shrink-0 dshx:transition-transform dshx:group-hover/gap:translate-y-0.5" />
      </button>
    </div>
  )
}
