import * as React from 'react'
import { animate, drawStroke, durations, easings } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'

export interface NodeLink {
  readonly id: string
  /** `data-node-anchor` value of the source element; the link leaves its right edge. */
  readonly from: string
  /** `data-node-anchor` value of the target element; the link enters its left edge. */
  readonly to: string
}

export interface NodeLinkLayout {
  readonly width: number
  readonly height: number
  /** SVG path per link id, in the container's coordinates. Missing until both ends are measured. */
  readonly paths: ReadonlyMap<string, string>
  /** End points per link id (start x/y, end x/y) for dots and labels. */
  readonly ends: ReadonlyMap<string, readonly [number, number, number, number]>
}

interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The element's layout box relative to the container, ignoring transforms so running enter animations do not skew links. */
function layoutBox(element: HTMLElement, container: HTMLElement, origin: DOMRect): Box {
  let left = 0
  let top = 0
  let node: HTMLElement | null = element
  while (node != null && node !== container) {
    left += node.offsetLeft
    top += node.offsetTop
    const parent: Element | null = node.offsetParent
    node = parent instanceof HTMLElement ? parent : null
  }
  if (node === container) return { left, top, width: element.offsetWidth, height: element.offsetHeight }
  const rect = element.getBoundingClientRect()
  return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height }
}

const emptyLayout: NodeLinkLayout = { width: 0, height: 0, paths: new Map(), ends: new Map() }

/**
 * Measures elements tagged `data-node-anchor` inside `containerRef` and returns cubic connector paths between them
 * (right edge to left edge), re-measured on resize and whenever `deps` change. Draw the paths in an absolutely
 * positioned SVG that covers the container. Spend maps, access maps, dependency trees.
 */
export function useNodeLinks(containerRef: React.RefObject<HTMLElement | null>, links: readonly NodeLink[], deps: React.DependencyList): NodeLinkLayout {
  const [layout, setLayout] = React.useState<NodeLinkLayout>(emptyLayout)
  const linksRef = React.useRef(links)
  linksRef.current = links

  const measure = React.useCallback(() => {
    const container = containerRef.current
    if (container == null) return
    const origin = container.getBoundingClientRect()
    const boxes = new Map<string, Box>()
    for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-node-anchor]'))) {
      const key = element.dataset.nodeAnchor
      // display:none (a column hidden at a narrow width) has no layout box: leave its links out.
      if (key === undefined || element.getClientRects().length === 0) continue
      boxes.set(key, layoutBox(element, container, origin))
    }
    const paths = new Map<string, string>()
    const ends = new Map<string, readonly [number, number, number, number]>()
    for (const link of linksRef.current) {
      const a = boxes.get(link.from)
      const b = boxes.get(link.to)
      if (a === undefined || b === undefined) continue
      const x1 = a.left + a.width
      const y1 = a.top + a.height / 2
      const x2 = b.left
      const y2 = b.top + b.height / 2
      const dx = Math.max(12, (x2 - x1) * 0.55)
      paths.set(
        link.id,
        `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
      )
      ends.set(link.id, [x1, y1, x2, y2])
    }
    setLayout({ width: origin.width, height: origin.height, paths, ends })
  }, [containerRef])

  React.useLayoutEffect(() => {
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps])

  React.useEffect(() => {
    const container = containerRef.current
    if (container == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, measure])

  return layout
}

export interface DrawnPathProps extends React.SVGProps<SVGPathElement> {
  readonly d: string
  /** Redraw the stroke whenever this changes (a new selection). */
  readonly drawKey?: React.Key
  readonly delay?: number
  readonly duration?: number
}

/** An SVG path that draws itself in on mount and whenever `drawKey` changes; resizes afterwards just update `d`. */
export function DrawnPath({ d, drawKey, delay = 0, duration = durations.slow, ...props }: DrawnPathProps) {
  const ref = React.useRef<SVGPathElement>(null)
  const ready = d !== ''
  React.useLayoutEffect(() => {
    const path = ref.current
    if (path == null || !ready) return
    const controls = drawStroke(path, { duration, delay, ease: easings.out })
    void controls.finished.then(() => {
      path.style.strokeDasharray = ''
      path.style.strokeDashoffset = ''
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey, ready])
  return <path ref={ref} d={d} fill="none" {...props} />
}

export interface FlowPathProps extends React.SVGProps<SVGPathElement> {
  readonly d: string
  /** Seconds per trip along the path. */
  readonly duration?: number
}

/** A short bright dash travelling along `d` forever: traffic on an open path. Hidden under reduced motion. */
export function FlowPath({ d, duration = 1.6, ...props }: FlowPathProps) {
  const ref = React.useRef<SVGPathElement>(null)
  const reduced = usePrefersReducedMotion()
  React.useLayoutEffect(() => {
    const path = ref.current
    if (path == null || reduced || d === '') return
    const length = path.getTotalLength()
    const dash = Math.min(28, length / 4)
    path.style.strokeDasharray = `${dash} ${length}`
    const controls = animate(path, { strokeDashoffset: [dash, -length] }, { duration, ease: 'linear', repeat: Infinity })
    return () => controls.stop()
  }, [d, duration, reduced])
  if (reduced) return null
  return <path ref={ref} d={d} fill="none" {...props} />
}
