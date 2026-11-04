/**
 * Thin React bindings over the framework-free motion layer (`@dshfiles/plugin-ui/motion`). Hooks only hold refs and
 * effects; every animation still runs through the vanilla presets, so React and non-React surfaces move the same way.
 */
import * as React from 'react'
import {
  animate,
  countTo,
  enter,
  everyFrame,
  inView,
  motionSafe,
  prefersReducedMotion,
  type AnimationOptions,
  type AnimationPlaybackControls,
  type DOMKeyframesDefinition,
  type MotionPreset,
} from './index.js'

/** Live `prefers-reduced-motion`. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(prefersReducedMotion)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

type ScopedAnimate = (
  selectorOrElement: string | Element | readonly Element[],
  keyframes: DOMKeyframesDefinition,
  options?: AnimationOptions,
) => AnimationPlaybackControls | null

/** `Array.isArray` cannot narrow a readonly array out of a union; this guard can. */
function isElementList(target: Element | readonly Element[]): target is readonly Element[] {
  return Array.isArray(target)
}

/** Anything that changes when an enter animation should replay: an id, a count, a state name or a flag. */
export type ReplayKey = string | number | boolean | null | undefined

/**
 * A ref for a scope element plus an `animate` whose string selectors resolve inside that scope. Running animations
 * stop on unmount. Options pass through `motionSafe`.
 */
export function useAnimate<T extends Element = HTMLDivElement>(): readonly [React.RefObject<T>, ScopedAnimate] {
  const scope = React.useRef<T>(null)
  const running = React.useRef(new Set<AnimationPlaybackControls>())
  React.useEffect(() => {
    const set = running.current
    return () => {
      for (const controls of set) controls.stop()
      set.clear()
    }
  }, [])
  const run = React.useCallback<ScopedAnimate>((target, keyframes, options = {}) => {
    const root = scope.current
    let elements: Element[]
    if (typeof target === 'string') elements = root == null ? [] : Array.from(root.querySelectorAll(target))
    else if (isElementList(target)) elements = [...target]
    else elements = [target]
    if (elements.length === 0) return null
    const controls = animate(elements, keyframes, motionSafe(options))
    running.current.add(controls)
    void controls.finished.then(() => running.current.delete(controls))
    return controls
  }, [])
  return [scope, run] as const
}

/** Play an enter preset on the ref's element when it mounts and whenever `replayKey` changes. */
export function useEnter<T extends Element>(
  ref: React.RefObject<T>,
  preset: MotionPreset = 'riseIn',
  options: AnimationOptions & { readonly stagger?: number; readonly children?: boolean } = {},
  replayKey?: ReplayKey,
): void {
  const optionsRef = React.useRef(options)
  optionsRef.current = options
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const { children, ...rest } = optionsRef.current
    const target = children ? Array.from(element.children) : element
    const controls = enter(target, preset, rest)
    return () => controls?.stop()
  }, [ref, preset, replayKey])
}

/** Render `value` into the ref'd element as a count-up from its previous value. Returns the ref to attach. */
export function useCountUp<T extends HTMLElement = HTMLSpanElement>(
  value: number,
  options: AnimationOptions & { readonly format?: (value: number) => string; readonly from?: number } = {},
): React.RefObject<T> {
  const ref = React.useRef<T>(null)
  const previous = React.useRef<number>(options.from ?? 0)
  const optionsRef = React.useRef(options)
  optionsRef.current = options
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const { from: _from, ...rest } = optionsRef.current
    const controls = countTo(previous.current, value, (_n, text) => (element.textContent = text), rest)
    previous.current = value
    return () => controls.stop()
  }, [value])
  return ref
}

/** Whether the ref's element is in the viewport (once: stays true after the first sighting). */
export function useInView<T extends Element>(ref: React.RefObject<T>, options: { readonly once?: boolean; readonly amount?: number } = {}): boolean {
  const [visible, setVisible] = React.useState(false)
  const { once = true, amount = 0.2 } = options
  React.useEffect(() => {
    const element = ref.current
    if (element == null) return
    return inView(
      element,
      () => {
        setVisible(true)
        return once ? undefined : () => setVisible(false)
      },
      { amount },
    )
  }, [ref, once, amount])
  return visible
}

/** Seconds elapsed since `active` became true, updated every frame (0 while inactive). */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    return everyFrame(seconds => setElapsed(seconds))
  }, [active])
  return elapsed
}

/**
 * A highlight that slides between the items of a tab list or segmented control. Put `ref` on the list (it must be
 * `position: relative`), render `indicatorRef` as an absolutely positioned element inside it, and mark each item
 * with `data-indicator-key`. The indicator jumps to the active item on first paint and springs to it afterwards, so
 * the list keeps its own roles (`tablist`/`tab`) and keyboard behaviour.
 */
const activeItem = (list: HTMLElement, key: string): HTMLElement | undefined =>
  Array.from(list.querySelectorAll<HTMLElement>('[data-indicator-key]')).find(candidate => candidate.dataset.indicatorKey === key)

const placeIndicator = (indicator: HTMLElement, item: HTMLElement): void => {
  Object.assign(indicator.style, {
    opacity: '1',
    left: `${item.offsetLeft}px`,
    top: `${item.offsetTop}px`,
    width: `${item.offsetWidth}px`,
    height: `${item.offsetHeight}px`,
  })
}

export interface SlidingIndicator<L extends HTMLElement, I extends HTMLElement> {
  readonly ref: React.RefObject<L>
  readonly indicatorRef: React.RefObject<I>
}

export function useSlidingIndicator<L extends HTMLElement = HTMLDivElement, I extends HTMLElement = HTMLSpanElement>(
  activeKey: string,
): SlidingIndicator<L, I> {
  const ref = React.useRef<L>(null)
  const indicatorRef = React.useRef<I>(null)
  const placed = React.useRef(false)
  const activeRef = React.useRef(activeKey)
  activeRef.current = activeKey
  // A resize (pane drag, wrap, font load) moves the items without a key change: re-place without animating.
  React.useEffect(() => {
    const list = ref.current
    if (list == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const indicator = indicatorRef.current
      const item = activeItem(list, activeRef.current)
      if (indicator != null && item !== undefined) placeIndicator(indicator, item)
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])
  React.useLayoutEffect(() => {
    const list = ref.current
    const indicator = indicatorRef.current
    if (list == null || indicator == null) return
    const item = activeItem(list, activeKey)
    if (item === undefined) {
      indicator.style.opacity = '0'
      return
    }
    const box = { left: item.offsetLeft, top: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight }
    if (!placed.current) {
      placed.current = true
      placeIndicator(indicator, item)
      return
    }
    const controls = animate(
      indicator,
      { opacity: 1, left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` },
      motionSafe({ type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }),
    )
    return () => controls.stop()
  }, [activeKey])
  return { ref, indicatorRef }
}

interface LayoutPoint {
  readonly x: number
  readonly y: number
}

/** Layout position from the offsetParent chain: ignores transforms and the scroll of ancestors outside the chain. */
const documentOffset = (element: HTMLElement): LayoutPoint => {
  let x = 0
  let y = 0
  for (let node: Element | null = element; node instanceof HTMLElement; node = node.offsetParent) {
    x += node.offsetLeft
    y += node.offsetTop
  }
  return { x, y }
}

/** Where `child` sits inside `container`, as laid out (not as currently painted). */
const layoutWithin = (child: HTMLElement, container: HTMLElement): LayoutPoint => {
  const inner = documentOffset(child)
  const outer = documentOffset(container)
  return { x: inner.x - outer.x, y: inner.y - outer.y }
}

/** The translation an interrupted FLIP left on the element, so the next one starts where it is painted. */
const currentTranslation = (element: HTMLElement): LayoutPoint => {
  const transform = getComputedStyle(element).transform
  if (transform === '' || transform === 'none' || typeof DOMMatrixReadOnly === 'undefined') return { x: 0, y: 0 }
  const matrix = new DOMMatrixReadOnly(transform)
  return { x: matrix.m41, y: matrix.m42 }
}

/**
 * FLIP children of the ref'd container whenever `deps` change: each child tagged `data-flip-key` animates from its
 * previous place to its new one. Children that appear get the `enterPreset`. Works for reorders, inserts and wraps.
 *
 * Places are layout offsets inside the container, so scrolling the page or a pane between two changes does not
 * offset the rows, and an interrupted move continues from where it is painted instead of jumping.
 */
export function useFlip<T extends HTMLElement>(
  ref: React.RefObject<T>,
  deps: React.DependencyList,
  options: AnimationOptions & { readonly enterPreset?: MotionPreset | null } = {},
): void {
  const places = React.useRef(new Map<string, LayoutPoint>())
  const optionsRef = React.useRef(options)
  optionsRef.current = options
  React.useLayoutEffect(() => {
    const container = ref.current
    if (container == null) return
    const { enterPreset = 'riseIn', ...rest } = optionsRef.current
    const next = new Map<string, LayoutPoint>()
    const fresh: Element[] = []
    const controls: AnimationPlaybackControls[] = []
    for (const child of Array.from(container.querySelectorAll<HTMLElement>('[data-flip-key]'))) {
      const key = child.dataset.flipKey
      if (key === undefined) continue
      const place = layoutWithin(child, container)
      next.set(key, place)
      const before = places.current.get(key)
      if (before === undefined) {
        if (places.current.size > 0) fresh.push(child)
        continue
      }
      const painted = currentTranslation(child)
      const dx = before.x + painted.x - place.x
      const dy = before.y + painted.y - place.y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      controls.push(
        animate(
          child,
          { transform: [`translate(${dx}px, ${dy}px)`, 'translate(0px, 0px)'] },
          motionSafe({ type: 'spring', stiffness: 300, damping: 32, ...rest }),
        ),
      )
    }
    const entering = enterPreset !== null && fresh.length > 0 ? enter(fresh, enterPreset, { stagger: 0.04 }) : null
    places.current = next
    return () => {
      // A move stops where it is painted, so the next change reads that and continues from there; an enter finishes,
      // so no row is left half faded.
      for (const c of controls) c.stop()
      entering?.complete()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
