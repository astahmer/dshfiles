import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import { ServiceMapLayout } from './service-map-layout.js'
import type { ServiceMap } from './types.js'

const NODE_WIDTH = 216
const NODE_HEIGHT = 52
const COLUMN_GAP = 96
const ROW_GAP = 28
const PADDING = 16

const nodeX = (column: number): number => PADDING + column * (NODE_WIDTH + COLUMN_GAP)
const nodeY = (row: number): number => PADDING + row * (NODE_HEIGHT + ROW_GAP)

/** Services as boxes, calls as arrows from caller to callee; red when any call in the window failed. */
export const ServiceMapView = (props: {
  readonly map: ServiceMap
  readonly onPickService: (service: string) => void
  readonly t: TracesTranslate
}): JSX.Element => {
  const placed = ServiceMapLayout.layout(
    props.map.nodes.map(node => node.service),
    props.map.edges,
  )
  if (placed.nodes.length === 0) return <p className="dshx:text-sm dshx:text-muted-foreground">{props.t('noOperations')}</p>
  const position = new Map(placed.nodes.map(node => [node.service, node]))
  const stats = new Map(props.map.nodes.map(node => [node.service, node]))
  const width = PADDING * 2 + placed.columns * NODE_WIDTH + Math.max(0, placed.columns - 1) * COLUMN_GAP
  const height = PADDING * 2 + placed.rows * NODE_HEIGHT + Math.max(0, placed.rows - 1) * ROW_GAP
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      {props.map.edges.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('noServiceCalls')}</p> : null}
      <div className="dshx:overflow-auto dshx:rounded-md dshx:border dshx:border-border">
        <svg
          role="img"
          aria-label={props.t('serviceMap')}
          width={width}
          height={height}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          className="dshx:block"
        >
          <defs>
            <marker id="dshfiles-traces-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="dshx:fill-muted-foreground" />
            </marker>
            <marker id="dshfiles-traces-arrow-error" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="dshx:fill-destructive" />
            </marker>
          </defs>
          {props.map.edges.map(edge => {
            const from = position.get(edge.source)
            const to = position.get(edge.target)
            if (from === undefined || to === undefined) return null
            const forward = to.column > from.column
            const startX = forward ? nodeX(from.column) + NODE_WIDTH : nodeX(from.column) + NODE_WIDTH / 2
            const startY = forward ? nodeY(from.row) + NODE_HEIGHT / 2 : nodeY(from.row) + NODE_HEIGHT
            const endX = forward ? nodeX(to.column) : nodeX(to.column) + NODE_WIDTH / 2
            const endY = forward ? nodeY(to.row) + NODE_HEIGHT / 2 : nodeY(to.row)
            const bend = forward ? (endX - startX) / 2 : 40
            const path = forward
              ? `M ${String(startX)} ${String(startY)} C ${String(startX + bend)} ${String(startY)}, ${String(endX - bend)} ${String(endY)}, ${String(endX)} ${String(endY)}`
              : `M ${String(startX)} ${String(startY)} C ${String(startX + bend)} ${String(startY + bend)}, ${String(endX + bend)} ${String(endY - bend)}, ${String(endX)} ${String(endY)}`
            const failing = edge.errorCount > 0
            return (
              <g key={`${edge.source}\u0000${edge.target}`} data-edge={`${edge.source}->${edge.target}`} data-errors={edge.errorCount}>
                <title>{`${edge.source} → ${edge.target}: ${String(edge.count)} calls, ${TraceFormat.percent(edge.errorRate)} errors, p95 ${TraceFormat.duration(edge.p95Ms)}`}</title>
                <path
                  d={path}
                  fill="none"
                  strokeWidth={Math.min(4, 1 + Math.log10(edge.count + 1))}
                  className={failing ? 'dshx:stroke-destructive' : 'dshx:stroke-muted-foreground/60'}
                  markerEnd={failing ? 'url(#dshfiles-traces-arrow-error)' : 'url(#dshfiles-traces-arrow)'}
                />
                <text
                  x={(startX + endX) / 2}
                  y={(startY + endY) / 2 - 6}
                  textAnchor="middle"
                  className={cn('dshx:font-mono dshx:text-[10px]', failing ? 'dshx:fill-destructive' : 'dshx:fill-muted-foreground')}
                >
                  {`${String(edge.count)}× ${failing ? TraceFormat.percent(edge.errorRate) : TraceFormat.duration(edge.p50Ms)}`}
                </text>
              </g>
            )
          })}
          {placed.nodes.map(node => {
            const summary = stats.get(node.service)
            const failing = (summary?.errorCount ?? 0) > 0
            return (
              <g
                key={node.service}
                role="button"
                tabIndex={0}
                aria-label={`${props.t('service')} ${node.service}`}
                data-service={node.service}
                className="dshx:cursor-pointer"
                transform={`translate(${String(nodeX(node.column))} ${String(nodeY(node.row))})`}
                onClick={() => props.onPickService(node.service)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') props.onPickService(node.service)
                }}
              >
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={8}
                  strokeWidth={failing ? 2 : 1}
                  className={cn('dshx:fill-background', failing ? 'dshx:stroke-destructive' : 'dshx:stroke-border')}
                />
                <rect width={6} height={NODE_HEIGHT} rx={3} className={TraceFormat.serviceFill(node.service)} />
                <text x={16} y={21} className="dshx:fill-foreground dshx:text-xs dshx:font-medium">
                  {node.service.length > 28 ? `${node.service.slice(0, 27)}…` : node.service}
                </text>
                <text x={16} y={38} className="dshx:fill-muted-foreground dshx:font-mono dshx:text-[10px]">
                  {summary === undefined
                    ? ''
                    : `${String(summary.count)} ${props.t('spans')} · ${TraceFormat.percent(summary.errorRate)} · p95 ${TraceFormat.duration(summary.p95Ms)}`}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
