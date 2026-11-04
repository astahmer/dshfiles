import * as React from 'react'
import { animate, easings, motionSafe, presets, springs, staggers, type AnimationPlaybackControls } from '../../motion/index.js'
import { GitBranchIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { PresenceList } from './presence-list.js'
import { RollingNumber } from './text.js'

export type CallFrameStatus = 'new' | 'changed' | 'existing'

export interface CallFrame {
  readonly id: string
  /** Object or module before the dot ("ScheduleCheck"). */
  readonly receiver?: string
  readonly name: string
  /** Argument text inside the parentheses; truncated when long. */
  readonly args?: string
  readonly file?: string
  readonly line?: number
  readonly status?: CallFrameStatus
  readonly children?: readonly CallFrame[]
}

export interface CallStackTreeProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  /** Change / PR reference shown in the pill ("#60140"). */
  readonly reference?: string
  readonly roots: readonly CallFrame[]
  /** Frames collapsed by default. */
  readonly defaultCollapsed?: readonly string[]
  readonly selectedId?: string
  readonly onSelectFrame?: (id: string) => void
}

/** Indent per depth level, as a CSS length so narrow panes can tighten it (see `--dshx-call-indent` on the root). */
const indent = (levels: number, plus = 0) => `calc(var(--dshx-call-indent) * ${levels} + ${plus}px)`
const ROW = 26

interface FlatRow {
  readonly frame: CallFrame
  readonly depth: number
  /** For each ancestor level 1..depth-1: whether that ancestor has later siblings (a guide line passes this row). */
  readonly guides: readonly boolean[]
  readonly last: boolean
  readonly parentFile: string | undefined
  readonly path: readonly string[]
  readonly rootIndex: number
}

const squareTone = {
  new: 'dshx:bg-success',
  changed: 'dshx:bg-warning',
  existing: 'dshx:border-[1.5px] dshx:border-muted-foreground/70 dshx:bg-card',
} as const satisfies Record<CallFrameStatus, string>

/**
 * A change's call path as an indented stack: each frame a mono line (`Receiver.method(args)` with file:line on the
 * right), tree elbows to its callees, and a square that is green for new frames, amber for changed ones and hollow for
 * existing code. Frames cascade in depth-first — the elbow draws down, the square pops, the call slides in — and
 * frames with callees fold and unfold with the same choreography.
 */
export function CallStackTree({ heading, reference, roots, defaultCollapsed = [], selectedId, onSelectFrame, className, ...props }: CallStackTreeProps) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set(defaultCollapsed))
  const [hovered, setHovered] = React.useState<string | null>(null)
  const seen = React.useRef<ReadonlySet<string>>(new Set())
  const mounted = React.useRef(false)

  const rows: FlatRow[] = []
  const walk = (
    frames: readonly CallFrame[],
    depth: number,
    guides: readonly boolean[],
    parentFile: string | undefined,
    path: readonly string[],
    rootIndex: number,
  ) => {
    frames.forEach((frame, i) => {
      const last = i === frames.length - 1
      const root = depth === 0 ? i : rootIndex
      rows.push({ frame, depth, guides, last, parentFile, path, rootIndex: root })
      if (frame.children && frame.children.length > 0 && !collapsed.has(frame.id)) {
        walk(frame.children, depth + 1, depth === 0 ? [] : [...guides, !last], frame.file ?? parentFile, [...path, frame.id], root)
      }
    })
  }
  walk(roots, 0, [], undefined, [], 0)

  const counts = { new: 0, files: new Set<string>() }
  const count = (frames: readonly CallFrame[]) => {
    for (const frame of frames) {
      if (frame.status === 'new') counts.new++
      if (frame.file && frame.status !== 'existing') counts.files.add(frame.file)
      if (frame.children) count(frame.children)
    }
  }
  count(roots)

  // Rows that were not visible last render cascade in; on first mount the whole tree does.
  let fresh = 0
  const delays = new Map<string, number>()
  for (const row of rows) {
    if (!seen.current.has(row.frame.id))
      delays.set(row.frame.id, (mounted.current ? 0 : 0.15) + fresh++ * staggers.base + row.rootIndex * (mounted.current ? 0 : 0.08))
  }
  React.useEffect(() => {
    mounted.current = true
    seen.current = new Set(rows.map(row => row.frame.id))
  })

  const hoveredPath = hovered === null ? null : new Set([...(rows.find(row => row.frame.id === hovered)?.path ?? []), hovered])
  const toggle = (id: string) =>
    setCollapsed(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-4 dshx:text-card-foreground dshx:[--dshx-call-indent:20px] dshx:@max-pane-narrow:gap-2.5 dshx:@max-pane-narrow:p-3 dshx:@max-pane-narrow:[--dshx-call-indent:14px]',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:flex-col dshx:gap-2">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3">
          {reference ? (
            <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:py-1 dshx:text-sm dshx:font-semibold">
              <GitBranchIcon className="dshx:size-3.5 dshx:text-violet" />
              {reference}
            </span>
          ) : null}
          <h3 className="dshx:min-w-0 dshx:truncate dshx:text-base dshx:font-semibold dshx:@max-pane-narrow:line-clamp-2 dshx:@max-pane-narrow:text-sm dshx:@max-pane-narrow:whitespace-normal">
            {heading}
          </h3>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-4 dshx:text-sm dshx:text-muted-foreground">
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <span className="dshx:size-2.5 dshx:rounded-[2px] dshx:bg-success" />
            <span className="dshx:text-foreground/80">
              <RollingNumber value={counts.new} /> new
            </span>
          </span>
          <span>
            <RollingNumber value={counts.files.size} /> {counts.files.size === 1 ? 'file' : 'files'}
          </span>
        </div>
      </header>
      <PresenceList
        as="ul"
        aria-label="Call path"
        enter={null}
        exit="fadeOut"
        className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:p-0 dshx:font-mono dshx:text-[12.5px]"
        onMouseLeave={() => setHovered(null)}
        items={rows.map((row, index) => ({
          key: row.frame.id,
          node: (
            <FrameRow
              row={row}
              delay={delays.get(row.frame.id) ?? null}
              gap={index > 0 && row.depth === 0}
              expanded={!collapsed.has(row.frame.id)}
              onToggle={toggle}
              onHover={setHovered}
              onSelect={onSelectFrame}
              selected={selectedId === row.frame.id}
              onPath={hoveredPath?.has(row.frame.id) ?? false}
            />
          ),
        }))}
      />
    </section>
  )
}

function FrameRow({
  row,
  delay,
  gap,
  expanded,
  onToggle,
  onHover,
  onSelect,
  selected,
  onPath,
}: {
  readonly row: FlatRow
  readonly delay: number | null
  readonly gap: boolean
  readonly expanded: boolean
  readonly onToggle: (id: string) => void
  readonly onHover: (id: string) => void
  readonly onSelect: ((id: string) => void) | undefined
  readonly selected: boolean
  readonly onPath: boolean
}) {
  const { frame, depth, guides, last } = row
  const elbow = React.useRef<HTMLSpanElement>(null)
  const square = React.useRef<HTMLSpanElement>(null)
  const text = React.useRef<HTMLSpanElement>(null)
  // The cascade plays once, with the delay the row had when it first appeared.
  const enterDelay = React.useRef(delay)
  React.useLayoutEffect(() => {
    const at = enterDelay.current
    if (at === null) return
    const running: AnimationPlaybackControls[] = []
    if (elbow.current)
      running.push(animate(elbow.current, { transform: ['scaleY(0)', 'scaleY(1)'] }, motionSafe({ duration: 0.18, ease: easings.out, delay: at })))
    if (square.current)
      running.push(animate(square.current, { opacity: [0, 1], transform: ['scale(0)', 'scale(1)'] }, motionSafe({ ...springs.bouncy, delay: at + 0.1 })))
    if (text.current) running.push(animate(text.current, presets.slideInLeft, motionSafe({ ...springs.smooth, delay: at + 0.12 })))
    return () => {
      for (const controls of running) controls.complete()
    }
  }, [])

  const hasChildren = (frame.children?.length ?? 0) > 0
  const status = frame.status ?? 'existing'
  const sameFile = frame.file !== undefined && frame.file === row.parentFile
  const squareClass = cn('dshx:block dshx:size-2.5 dshx:shrink-0 dshx:rounded-[2px]', squareTone[status], onPath && 'dshx:ring-2 dshx:ring-success/30')
  // Motion pops the wrapper; the button's hover scale stays on its own element so the two never compound.
  const squareEl = hasChildren ? (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${frame.receiver ? `${frame.receiver}.` : ''}${frame.name}`}
      onClick={() => onToggle(frame.id)}
      className={cn(
        squareClass,
        'dshx:cursor-pointer dshx:outline-none dshx:transition-transform dshx:hover:scale-125 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/60',
      )}
    />
  ) : (
    <span aria-hidden className={squareClass} />
  )

  return (
    <div
      onMouseEnter={() => onHover(frame.id)}
      className={cn(
        'dshx:relative dshx:flex dshx:items-center dshx:rounded-md dshx:pr-1 dshx:transition-colors',
        gap && 'dshx:mt-3',
        selected ? 'dshx:bg-accent' : onPath ? 'dshx:bg-accent/40' : '',
      )}
      style={{ height: ROW }}
    >
      <span aria-hidden className="dshx:relative dshx:h-full dshx:shrink-0" style={{ width: indent(depth) }}>
        {guides.map((through, level) =>
          through ? <span key={level} className="dshx:absolute dshx:top-0 dshx:bottom-0 dshx:w-px dshx:bg-border" style={{ left: indent(level, 5) }} /> : null,
        )}
        {depth > 0 ? (
          <>
            <span
              ref={elbow}
              className="dshx:absolute dshx:top-0 dshx:h-1/2 dshx:origin-top dshx:rounded-bl-[5px] dshx:border-b dshx:border-l dshx:border-border"
              style={{ left: indent(depth - 1, 5), width: indent(1, -5) }}
            />
            {last ? null : <span className="dshx:absolute dshx:top-1/2 dshx:bottom-0 dshx:w-px dshx:bg-border" style={{ left: indent(depth - 1, 5) }} />}
          </>
        ) : null}
      </span>
      <span ref={square} className="dshx:flex dshx:shrink-0">
        {squareEl}
      </span>
      <span ref={text} className="dshx:ml-2.5 dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-3">
        <button
          type="button"
          disabled={!onSelect}
          onClick={() => onSelect?.(frame.id)}
          className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left dshx:font-mono! dshx:text-muted-foreground dshx:outline-none dshx:disabled:cursor-default dshx:focus-visible:underline"
        >
          {frame.receiver ? `${frame.receiver}.` : ''}
          <span className="dshx:font-semibold dshx:text-foreground">{frame.name}</span>({frame.args ?? ''})
          {!expanded && hasChildren ? <span className="dshx:ml-2 dshx:rounded dshx:bg-muted dshx:px-1 dshx:text-[11px]">+{frame.children?.length}</span> : null}
        </button>
        {frame.line !== undefined ? (
          <span className="dshx:shrink-0 dshx:text-muted-foreground">
            {sameFile || frame.file === undefined ? null : <span className="dshx:text-foreground/80 dshx:@max-pane-narrow:hidden">{frame.file}</span>}:
            {frame.line}
          </span>
        ) : null}
      </span>
    </div>
  )
}
