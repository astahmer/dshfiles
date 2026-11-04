import * as React from 'react'
import { animate, drawStroke, durations, easings, motionSafe, type AnimationPlaybackControls } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'

/**
 * Row-aligned lane graph: the commit-graph / DAG gutter drawn as one small SVG per table row, so every row (and its
 * piece of each edge) moves with the row itself — FLIP reorders, inserts and collapses keep the graph intact.
 *
 * `layoutLaneGraph(rows, edges)` cuts every edge into per-row segments; `LaneGraphCell` renders one row's segments
 * plus its node and draws them in on mount. Shared by MergeConflictGraph, PipelineDag and RevisionAvatarGraph.
 */

export type LaneTone = 'muted' | 'info' | 'teal' | 'violet' | 'success' | 'warning' | 'destructive' | 'primary'

/** Stroke colour (via currentColor) per tone. */
export const laneStroke = {
  muted: 'dshx:text-muted-foreground/45',
  info: 'dshx:text-info',
  teal: 'dshx:text-teal',
  violet: 'dshx:text-violet',
  success: 'dshx:text-success',
  warning: 'dshx:text-warning',
  destructive: 'dshx:text-destructive',
  primary: 'dshx:text-primary',
} as const satisfies Record<LaneTone, string>

/** Solid node fill per tone. */
export const laneFill = {
  muted: 'dshx:bg-muted-foreground/55',
  info: 'dshx:bg-info',
  teal: 'dshx:bg-teal',
  violet: 'dshx:bg-violet',
  success: 'dshx:bg-success',
  warning: 'dshx:bg-warning',
  destructive: 'dshx:bg-destructive',
  primary: 'dshx:bg-primary',
} as const satisfies Record<LaneTone, string>

/** Ring colour per tone (avatars, hollow nodes). */
export const laneRing = {
  muted: 'dshx:ring-muted-foreground/50',
  info: 'dshx:ring-info',
  teal: 'dshx:ring-teal',
  violet: 'dshx:ring-violet',
  success: 'dshx:ring-success',
  warning: 'dshx:ring-warning',
  destructive: 'dshx:ring-destructive',
  primary: 'dshx:ring-primary',
} as const satisfies Record<LaneTone, string>

/** Soft chip (bookmark, branch label) per tone. */
export const laneChip = {
  muted: 'dshx:bg-muted dshx:text-muted-foreground',
  info: 'dshx:bg-info/12 dshx:text-info',
  teal: 'dshx:bg-teal/12 dshx:text-teal',
  violet: 'dshx:bg-violet/12 dshx:text-violet',
  success: 'dshx:bg-success/12 dshx:text-success',
  warning: 'dshx:bg-warning/12 dshx:text-warning',
  destructive: 'dshx:bg-destructive/12 dshx:text-destructive',
  primary: 'dshx:bg-primary/12 dshx:text-primary',
} as const satisfies Record<LaneTone, string>

const defaultLaneTones: readonly LaneTone[] = ['muted', 'info', 'teal', 'violet', 'warning']

/** Default tone of a lane: lane 0 is the trunk (muted), side lanes cycle through the accent tones. */
export const toneForLane = (lane: number): LaneTone => defaultLaneTones[lane % defaultLaneTones.length] ?? 'muted'

export interface LaneGraphRow {
  readonly id: string
  readonly lane: number
}

export interface LaneGraphEdge {
  /** Either endpoint may be the upper row; the layout sorts them. */
  readonly from: string
  readonly to: string
  readonly tone?: LaneTone
  readonly dashed?: boolean
  /** Where the lane change bends: next to the upper or the lower row. Default: next to the endpoint on the lower lane. */
  readonly bend?: 'upper' | 'lower'
  /** Draw an arrowhead into the lower node (pipelines). */
  readonly arrow?: boolean
}

export interface LaneSegment {
  readonly key: string
  readonly d: string
  readonly tone: LaneTone
  readonly dashed: boolean
}

export interface LaneGraphGeometry {
  readonly laneWidth: number
  readonly rowHeight: number
  /** Node radius, so arrowheads stop at the node edge. */
  readonly nodeRadius: number
}

export interface LaneGraphLayout {
  readonly lanes: number
  readonly geometry: LaneGraphGeometry
  readonly segments: ReadonlyMap<string, readonly LaneSegment[]>
}

export const defaultLaneGeometry: LaneGraphGeometry = { laneWidth: 14, rowHeight: 28, nodeRadius: 4 }

/** Cut every edge into per-row SVG segments. Rows are in display order (top to bottom). */
export function layoutLaneGraph(rows: readonly LaneGraphRow[], edges: readonly LaneGraphEdge[], geometry: Partial<LaneGraphGeometry> = {}): LaneGraphLayout {
  const geo: LaneGraphGeometry = { ...defaultLaneGeometry, ...geometry }
  const { laneWidth: W, rowHeight: H, nodeRadius: r } = geo
  const mid = H / 2
  const x = (lane: number) => lane * W + W / 2
  const index = new Map(rows.map((row, i) => [row.id, i] as const))
  const out = new Map<string, LaneSegment[]>(rows.map(row => [row.id, []]))
  const push = (rowIndex: number, segment: LaneSegment) => {
    const row = rows[rowIndex]
    if (row !== undefined) out.get(row.id)?.push(segment)
  }
  for (const edge of edges) {
    const i = index.get(edge.from)
    const j = index.get(edge.to)
    if (i === undefined || j === undefined || i === j) continue
    const [u, w] = i < j ? [i, j] : [j, i]
    const upper = rows[u]
    const lower = rows[w]
    if (upper === undefined || lower === undefined) continue
    const a = upper.lane
    const b = lower.lane
    const tone = edge.tone ?? toneForLane(Math.max(a, b))
    const dashed = edge.dashed ?? false
    const bend = edge.bend ?? (a <= b ? 'upper' : 'lower')
    const id = `${upper.id}>${lower.id}`
    const xa = x(a)
    const xb = x(b)
    const running = a === b ? a : bend === 'upper' ? b : a
    // upper row, bottom half
    push(u, {
      key: `${id}:u`,
      d: a === b || bend === 'lower' ? `M${xa} ${mid}L${xa} ${H}` : `M${xa} ${mid}C${xa} ${(mid + H) / 2} ${xb} ${(mid + H) / 2} ${xb} ${H}`,
      tone,
      dashed,
    })
    // rows in between
    for (let k = u + 1; k < w; k++) push(k, { key: `${id}:m`, d: `M${x(running)} 0L${x(running)} ${H}`, tone, dashed })
    // lower row, top half
    const tip = edge.arrow ? mid - r - 1.5 : mid
    push(w, {
      key: `${id}:l`,
      d: a === b || bend === 'upper' ? `M${xb} 0L${xb} ${tip}` : `M${xa} 0C${xa} ${mid / 2} ${xb} ${mid / 2} ${xb} ${tip}`,
      tone,
      dashed,
    })
    if (edge.arrow) push(w, { key: `${id}:a`, d: `M${xb - 3} ${tip - 3.5}L${xb} ${tip}L${xb + 3} ${tip - 3.5}`, tone, dashed: false })
  }
  const lanes = rows.reduce((max, row) => Math.max(max, row.lane + 1), 1)
  return { lanes, geometry: geo, segments: out }
}

export interface LaneGraphCellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly layout: LaneGraphLayout
  readonly rowId: string
  /** Lane of this row's node; the node is centred on it. */
  readonly lane: number
  readonly node?: React.ReactNode
  /** Draw this row's segments in on mount, after this many seconds. `null` shows them at once. */
  readonly drawDelay?: number | null
}

/** One row's slice of the lane graph: its edge segments and its node, centred on `lane`. */
export function LaneGraphCell({ layout, rowId, lane, node, drawDelay = 0, className, style, ...props }: LaneGraphCellProps) {
  const { laneWidth: W, rowHeight: H } = layout.geometry
  const width = layout.lanes * W
  const segments = layout.segments.get(rowId) ?? []
  return (
    <div aria-hidden className={cn('dshx:relative dshx:shrink-0', className)} style={{ width, height: H, ...style }} {...props}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="dshx:absolute dshx:inset-0 dshx:overflow-visible">
        {segments.map(segment => (
          <LanePath key={segment.key} segment={segment} drawDelay={drawDelay} />
        ))}
      </svg>
      {node === undefined ? null : (
        <div
          className="dshx:absolute dshx:top-1/2 dshx:flex dshx:-translate-x-1/2 dshx:-translate-y-1/2 dshx:items-center dshx:justify-center"
          style={{ left: lane * W + W / 2 }}
        >
          {node}
        </div>
      )}
    </div>
  )
}

function LanePath({ segment, drawDelay }: { readonly segment: LaneSegment; readonly drawDelay: number | null }) {
  const ref = React.useRef<SVGPathElement>(null)
  // Draw once, when the segment first appears: later delay or dash changes must not replay the entrance.
  const delay = React.useRef(drawDelay)
  const dashed = React.useRef(segment.dashed)
  React.useLayoutEffect(() => {
    const path = ref.current
    if (path == null || delay.current === null) return
    let controls: AnimationPlaybackControls
    if (dashed.current) {
      controls = animate(path, { opacity: [0, 1] }, motionSafe({ duration: durations.slow, delay: delay.current }))
    } else {
      controls = drawStroke(path, { duration: durations.base, ease: easings.out, delay: delay.current })
      void controls.finished.then(() => {
        // Clear the measured dash so a later change of `d` (lanes shifting) is not cut at the old length.
        path.style.strokeDasharray = ''
        path.style.strokeDashoffset = ''
      })
    }
    return () => controls.complete()
  }, [])
  return (
    <path
      ref={ref}
      d={segment.d}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      // Butt caps on edge segments: round caps overlap at every row boundary and bead translucent (muted) lanes.
      strokeLinecap={segment.key.endsWith(':a') ? 'round' : 'butt'}
      strokeLinejoin="round"
      strokeDasharray={segment.dashed ? '2 3' : undefined}
      className={cn('dshx:transition-colors dshx:duration-500', laneStroke[segment.tone])}
    />
  )
}
