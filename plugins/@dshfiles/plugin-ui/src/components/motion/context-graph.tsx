import * as React from 'react'
import { animate, drawStroke, easings, motionSafe, presets, springs, staggers, type AnimationPlaybackControls } from '../../motion/index.js'
import { CheckIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'

export interface GraphNodeItem {
  readonly id: string
  readonly label: React.ReactNode
  readonly icon?: React.ReactNode
  /** Trailing meta: a count, a check. */
  readonly meta?: React.ReactNode
  readonly selected?: boolean
}

export interface GraphNode {
  readonly id: string
  readonly label: React.ReactNode
  readonly icon?: React.ReactNode
  readonly count?: number
  readonly items?: readonly GraphNodeItem[]
  /** Free content under the items (a branch picker, an "Add folder" action). */
  readonly footer?: React.ReactNode
  /** Replaces the header and items: the composer node itself. */
  readonly body?: React.ReactNode
  /** Width class override, e.g. a wider composer. Static class strings only. */
  readonly className?: string
}

export interface GraphEdge {
  readonly from: string
  readonly to: string
}

export interface ContextGraphProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'onSelect'> {
  /** Columns from left to right; each column stacks its nodes. */
  readonly columns: readonly (readonly GraphNode[])[]
  readonly edges: readonly GraphEdge[]
  readonly onSelect?: (nodeId: string, itemId: string) => void
}

interface Wire {
  readonly key: string
  readonly d: string
  readonly start: readonly [number, number]
  readonly end: readonly [number, number]
}

/**
 * The agent composer as a node graph: context sources (repositories, branch, folders) are cards wired into the
 * composer. Nodes pop in column by column, wires draw themselves from source to target, picking an item swaps the
 * downstream node and re-draws its wire.
 */
export function ContextGraph({ columns, edges, onSelect, className, ...props }: ContextGraphProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [wires, setWires] = React.useState<readonly Wire[]>([])
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const drawn = React.useRef(new Set<string>())
  const edgesKey = edges.map(edge => `${edge.from}>${edge.to}`).join('|')
  const edgesRef = React.useRef(edges)
  edgesRef.current = edges

  const measure = React.useCallback(() => {
    const root = rootRef.current
    if (root == null) return
    // Layout offsets, not client rects: the pop-in scale must not skew the wire ends.
    const boxOf = (id: string) => {
      const element = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
      if (element == null) return undefined
      let left = 0
      let top = 0
      let current: HTMLElement | null = element
      while (current != null && current !== root) {
        left += current.offsetLeft
        top += current.offsetTop
        current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null
      }
      return { left, top, right: left + element.offsetWidth, height: element.offsetHeight }
    }
    const incoming = new Map<string, number>()
    for (const edge of edgesRef.current) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    const seenIn = new Map<string, number>()
    const next: Wire[] = []
    for (const edge of edgesRef.current) {
      const a = boxOf(edge.from)
      const b = boxOf(edge.to)
      if (a === undefined || b === undefined) continue
      const total = incoming.get(edge.to) ?? 1
      const slot = seenIn.get(edge.to) ?? 0
      seenIn.set(edge.to, slot + 1)
      const x1 = a.right
      const y1 = a.top + a.height / 2
      const x2 = b.left
      const spread = Math.min(b.height * 0.4, 24 * (total - 1))
      const y2 = b.top + b.height / 2 + (total === 1 ? 0 : -spread / 2 + (spread * slot) / (total - 1))
      const bend = Math.max(12, (x2 - x1) / 2)
      next.push({ key: `${edge.from}>${edge.to}`, d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, start: [x1, y1], end: [x2, y2] })
    }
    const signature = (list: readonly Wire[]) => list.map(wire => `${wire.key}=${wire.d}`).join('|')
    setWires(previous => (signature(previous) === signature(next) ? previous : next))
    // The node row, not the scroller: the SVG itself must not keep the size from shrinking.
    // Include its auto margin: the row is centred when it fits, so the wires start right of offsetLeft.
    const content = root.lastElementChild instanceof HTMLElement ? root.lastElementChild : root
    const width = (content === root ? 0 : content.offsetLeft) + content.offsetWidth
    const height = (content === root ? 0 : content.offsetTop) + content.offsetHeight
    setSize(previous => (previous.width === width && previous.height === height ? previous : { width, height }))
  }, [])

  const nodesKey = columns.map(column => column.map(node => node.id).join(',')).join('|')
  React.useLayoutEffect(() => {
    measure()
  }, [measure, edgesKey, nodesKey])

  React.useEffect(() => {
    const root = rootRef.current
    if (root == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(root)
    for (const node of Array.from(root.querySelectorAll('[data-node-id]'))) observer.observe(node)
    return () => observer.disconnect()
  }, [measure, nodesKey])

  React.useLayoutEffect(() => {
    const svg = svgRef.current
    if (svg == null) return
    const running: AnimationPlaybackControls[] = []
    const firstPass = drawn.current.size === 0
    for (const path of Array.from(svg.querySelectorAll<SVGPathElement>('path[data-wire]'))) {
      const key = path.dataset.wire ?? ''
      if (drawn.current.has(key)) continue
      drawn.current.add(key)
      const draw = drawStroke(path, { duration: 0.55, ease: easings.inOut, delay: firstPass ? 0.25 + running.length * 0.08 : 0.05 })
      void draw.finished.then(() => {
        path.style.strokeDasharray = ''
        path.style.strokeDashoffset = ''
      })
      running.push(draw)
    }
    const live = new Set(wires.map(wire => wire.key))
    for (const key of drawn.current) if (!live.has(key)) drawn.current.delete(key)
    return () => {
      for (const controls of running) controls.complete()
    }
  }, [wires])

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Context graph"
      className={cn('dshx:@container dshx:relative dshx:max-w-full dshx:overflow-x-auto dshx:overflow-y-hidden dshx:overscroll-x-contain', className)}
      {...props}
    >
      <svg
        ref={svgRef}
        aria-hidden
        width={size.width}
        height={size.height}
        className="dshx:pointer-events-none dshx:absolute dshx:top-0 dshx:left-0 dshx:text-muted-foreground/35"
      >
        {wires.map(wire => (
          <g key={wire.key}>
            <path data-wire={wire.key} d={wire.d} fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
            <circle cx={wire.end[0]} cy={wire.end[1]} r={3.5} className="dshx:fill-card dshx:stroke-muted-foreground/50" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      {/* w-max + mx-auto: centred when it fits, scrolls inside this box (never the card) when it does not. */}
      <div className="dshx:relative dshx:mx-auto dshx:flex dshx:w-max dshx:items-center dshx:gap-10 dshx:px-1 dshx:py-2 dshx:@max-pane-compact:gap-7 dshx:@max-pane-narrow:gap-5">
        {columns.map((column, columnIndex) => (
          <div key={columnIndex} className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:gap-3">
            {column.map((node, rowIndex) => (
              <NodeCard key={node.id} node={node} delay={columnIndex * staggers.loose + rowIndex * staggers.base} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function NodeCard({
  node,
  delay,
  onSelect,
}: {
  readonly node: GraphNode
  readonly delay: number
  readonly onSelect: ((nodeId: string, itemId: string) => void) | undefined
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const delayRef = React.useRef(delay)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, presets.popIn, motionSafe({ ...springs.smooth, delay: delayRef.current }))
    return () => controls.complete()
  }, [])
  return (
    <div
      ref={ref}
      data-node-id={node.id}
      role="group"
      aria-label={typeof node.label === 'string' ? node.label : undefined}
      className={cn(
        'dshx:flex dshx:w-44 dshx:flex-col dshx:gap-1 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-1.5 dshx:shadow-sm',
        node.className,
      )}
    >
      {node.body !== undefined ? (
        node.body
      ) : (
        <>
          <div className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:px-1.5 dshx:py-1 dshx:text-xs dshx:text-muted-foreground dshx:[&_svg]:size-3.5">
            {node.icon}
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{node.label}</span>
            {node.count !== undefined ? <span className="dshx:rounded dshx:bg-muted dshx:px-1.5 dshx:text-[10px] dshx:tabular-nums">{node.count}</span> : null}
          </div>
          {node.items !== undefined && node.items.length > 0 ? (
            <ul className="dshx:flex dshx:flex-col dshx:gap-0.5">
              {node.items.map(item => (
                <NodeItem key={item.id} item={item} onPick={onSelect === undefined ? undefined : () => onSelect(node.id, item.id)} />
              ))}
            </ul>
          ) : null}
          {node.footer}
        </>
      )}
    </div>
  )
}

function NodeItem({ item, onPick }: { readonly item: GraphNodeItem; readonly onPick: (() => void) | undefined }) {
  const ref = React.useRef<HTMLLIElement>(null)
  const first = React.useRef(true)
  const swapKey = typeof item.label === 'string' ? item.label : item.id
  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (ref.current == null) return
    const controls = animate(ref.current, presets.blurIn, motionSafe({ duration: 0.3, ease: easings.out }))
    return () => controls.complete()
  }, [swapKey])
  const content = (
    <>
      {item.icon !== undefined ? <span className="dshx:shrink-0 dshx:text-muted-foreground dshx:[&_svg]:size-3.5">{item.icon}</span> : null}
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left">{item.label}</span>
      {item.selected === true ? <CheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-foreground" /> : null}
      {item.meta !== undefined ? (
        <span className="dshx:shrink-0 dshx:rounded dshx:bg-muted dshx:px-1.5 dshx:text-[10px] dshx:text-muted-foreground dshx:tabular-nums">{item.meta}</span>
      ) : null}
    </>
  )
  const base = cn(
    'dshx:flex dshx:w-full dshx:items-center dshx:gap-1.5 dshx:rounded-lg dshx:px-1.5 dshx:py-1.5 dshx:text-xs dshx:text-foreground dshx:motion-safe:transition-colors',
    item.selected === true ? 'dshx:bg-accent' : 'dshx:bg-muted/40',
  )
  return (
    <li ref={ref}>
      {onPick !== undefined ? (
        <button
          type="button"
          aria-pressed={item.selected === true}
          onClick={onPick}
          className={cn(base, 'dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50')}
        >
          {content}
        </button>
      ) : (
        <div className={base}>{content}</div>
      )}
    </li>
  )
}
