import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { GraphDensity } from './preferences.js'
import type { Revision } from './api.js'
import type { GraphLane, RevisionGraphRow } from './graph.js'

export interface GraphMetrics {
  readonly rowHeight: number
  readonly laneGap: number
}

export const GRAPH_DENSITY = {
  comfortable: { rowHeight: 28, laneGap: 16 },
  compact: { rowHeight: 22, laneGap: 13 },
} as const satisfies Record<GraphDensity, GraphMetrics>

const LANE_WIDTH = 2

/** Indexed by `RevisionGraphRow.color`: the trunk, then one hue per side branch (`GRAPH_BRANCH_COLORS`). */
const GRAPH_STROKE = [
  'dshx:stroke-info',
  'dshx:stroke-graph-1',
  'dshx:stroke-graph-2',
  'dshx:stroke-graph-3',
  'dshx:stroke-graph-4',
  'dshx:stroke-graph-5',
  'dshx:stroke-graph-6',
] as const
const GRAPH_FILL = [
  'dshx:fill-info',
  'dshx:fill-graph-1',
  'dshx:fill-graph-2',
  'dshx:fill-graph-3',
  'dshx:fill-graph-4',
  'dshx:fill-graph-5',
  'dshx:fill-graph-6',
] as const
const graphStroke = (color: number): string => GRAPH_STROKE[color] ?? GRAPH_STROKE[0]
const graphFill = (color: number): string => GRAPH_FILL[color] ?? GRAPH_FILL[0]

const laneX = (metrics: GraphMetrics, lane: number): number => metrics.laneGap * 0.75 + lane * metrics.laneGap

export const graphWidthFor = (metrics: GraphMetrics, laneCount: number): number => laneX(metrics, Math.max(laneCount, 1) - 1) + metrics.laneGap * 0.75

/** A lane that runs straight down, or turns once with rounded corners at `turn`. */
const lanePath = (input: { readonly fromX: number; readonly toX: number; readonly top: number; readonly turn: number; readonly bottom: number }): string => {
  if (input.fromX === input.toX) return `M ${input.fromX} ${input.top} V ${input.bottom}`
  const direction = input.toX > input.fromX ? 1 : -1
  const radius = Math.min(6, Math.abs(input.toX - input.fromX) / 2, input.turn - input.top, input.bottom - input.turn)
  return [
    `M ${input.fromX} ${input.top}`,
    `V ${input.turn - radius}`,
    `Q ${input.fromX} ${input.turn} ${input.fromX + direction * radius} ${input.turn}`,
    `H ${input.toX - direction * radius}`,
    `Q ${input.toX} ${input.turn} ${input.toX} ${input.turn + radius}`,
    `V ${input.bottom}`,
  ].join(' ')
}

interface GraphLanesProps {
  readonly lanes: readonly GraphLane[]
  readonly metrics: GraphMetrics
  readonly width: number
}

/** Straight lane lines through a day heading or an expanded revision's details. */
export const GraphLanes = (props: GraphLanesProps): JSX.Element => (
  <svg aria-hidden className="dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:h-full" width={props.width}>
    {props.lanes.map(lane => (
      <line
        className={graphStroke(lane.color)}
        key={lane.lane}
        strokeLinecap="round"
        strokeWidth={LANE_WIDTH}
        x1={laneX(props.metrics, lane.lane)}
        x2={laneX(props.metrics, lane.lane)}
        y1="0"
        y2="100%"
      />
    ))}
  </svg>
)

export interface RevisionGraphCellProps {
  readonly revision: Revision
  readonly layout: RevisionGraphRow
  readonly metrics: GraphMetrics
  readonly height: number
  readonly width: number
}

export const RevisionGraphCell = (props: RevisionGraphCellProps): JSX.Element => {
  const revision = props.revision
  const layout = props.layout
  const height = props.height
  const middle = height / 2
  const turn = middle + (height - middle) / 2
  const x = (lane: number): number => laneX(props.metrics, lane)
  const commitX = x(layout.commitLane)
  const radius = props.metrics.laneGap * 0.36
  const stroke = revision.divergent ? 'dshx:stroke-violet' : graphStroke(layout.color)
  // Like VisualJJ: workspace heads are filled, every other revision is a hollow ring, and a conflict is a red ✗.
  const node = (() => {
    if (revision.conflict) {
      const arm = radius * 0.5
      return (
        <>
          <circle className="dshx:fill-background dshx:stroke-destructive" cx={commitX} cy={middle} r={radius + 0.5} strokeWidth={2} />
          <path
            className="dshx:stroke-destructive"
            d={`M ${commitX - arm} ${middle - arm} L ${commitX + arm} ${middle + arm} M ${commitX + arm} ${middle - arm} L ${commitX - arm} ${middle + arm}`}
            strokeLinecap="round"
            strokeWidth={1.75}
          />
        </>
      )
    }
    if (revision.workingCopy) {
      return (
        <>
          <circle className={cn('dshx:fill-none', stroke)} cx={commitX} cy={middle} r={radius + 2.5} strokeWidth={1.5} />
          <circle className={graphFill(layout.color)} cx={commitX} cy={middle} r={radius} />
        </>
      )
    }
    if (revision.workspaces.length > 0) {
      return <circle className={cn(graphFill(layout.color), 'dshx:stroke-background')} cx={commitX} cy={middle} r={radius + 0.5} strokeWidth={1.5} />
    }
    return (
      <circle
        className={cn('dshx:fill-background', stroke)}
        cx={commitX}
        cy={middle}
        r={radius - 0.5}
        strokeOpacity={revision.immutable ? 0.6 : 1}
        strokeWidth={2}
      />
    )
  })()
  return (
    <svg
      aria-hidden
      className="dshx:flex-none dshx:self-start dshx:overflow-visible"
      height={height}
      viewBox={`0 0 ${props.width} ${height}`}
      width={props.width}
    >
      <g fill="none" strokeLinecap="round" strokeWidth={LANE_WIDTH}>
        {layout.passing.map(link => (
          <path
            className={graphStroke(link.color)}
            d={lanePath({ fromX: x(link.fromLane), toX: x(link.toLane), top: 0, turn, bottom: height })}
            key={`pass-${link.fromLane}`}
          />
        ))}
        {layout.incoming.map(link => (
          <path
            className={graphStroke(link.color)}
            d={lanePath({ fromX: x(link.fromLane), toX: commitX, top: 0, turn: middle / 2, bottom: middle })}
            key={`in-${link.fromLane}`}
          />
        ))}
        {layout.outgoing.map((link, index) =>
          link.terminal ? (
            <path
              className={graphStroke(link.color)}
              d={`M ${commitX} ${middle} V ${middle + (height - middle) * 0.75}`}
              key={`stub-${index}`}
              strokeDasharray="1 3"
              strokeOpacity={0.6}
            />
          ) : (
            <path
              className={graphStroke(link.color)}
              d={lanePath({ fromX: commitX, toX: x(link.toLane), top: middle, turn, bottom: height })}
              key={`out-${link.toLane}-${index}`}
              strokeDasharray={link.dashed ? '2 3' : undefined}
              strokeOpacity={revision.immutable ? 0.5 : 1}
            />
          ),
        )}
      </g>
      {node}
    </svg>
  )
}
