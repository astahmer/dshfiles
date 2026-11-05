/**
 * Framework-free motion layer for every owned plugin.
 *
 * The engine is Motion's vanilla core (`motion`, MIT, https://motion.dev): springs, keyframes, stagger, sequences,
 * layout (FLIP) animations, view transitions, scroll/inView observers and hover/press gestures, all on plain DOM
 * elements and Web Animations where possible. Nothing here imports React; `./react.ts` adds thin hooks on top, so a
 * non-React surface (a Host-rendered card, an html-render page, a vanilla slot) can use the same presets.
 *
 * Use the presets below instead of ad-hoc numbers so every animated component in DSH moves with one feel.
 */
import {
  animate,
  animateLayout,
  animateView,
  cancelFrame,
  frame,
  hover,
  inView,
  mix,
  motionValue,
  press,
  scroll,
  spring,
  stagger,
  styleEffect,
  transform,
  type AnimationOptions,
  type AnimationPlaybackControls,
  type ValueAnimationTransition,
} from 'motion'
import type { AnimationSequence, DOMKeyframesDefinition, MotionValue, SpringOptions } from 'motion'

export { animate, animateLayout, animateView, cancelFrame, frame, hover, inView, mix, motionValue, press, scroll, spring, stagger, styleEffect, transform }
export type { AnimationOptions, AnimationPlaybackControls, AnimationSequence, DOMKeyframesDefinition, MotionValue, SpringOptions }

/** Spring feels. `snappy` for UI chrome, `smooth` for content and layout, `bouncy` for playful confirmation, `gentle` for big surfaces. */
export const springs = {
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 },
  smooth: { type: 'spring', stiffness: 300, damping: 32 },
  bouncy: { type: 'spring', stiffness: 420, damping: 18 },
  gentle: { type: 'spring', stiffness: 170, damping: 26 },
} as const satisfies Record<string, AnimationOptions>

/** Durations in seconds (Motion's unit). */
export const durations = {
  instant: 0.08,
  fast: 0.16,
  base: 0.24,
  slow: 0.4,
  slower: 0.7,
} as const

/** Cubic-bezier easings. `out` is the default for enters, `inOut` for moves without a spring, `in` for exits. */
export const easings = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.55, 0, 1, 0.45],
  emphasized: [0.2, 0, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>

/** Stagger step between siblings, in seconds. */
export const staggers = { tight: 0.03, base: 0.05, loose: 0.09 } as const

/** Keyframe presets for enters and exits. Pair them with `springs.*` or a duration and `easings.*`. */
export const presets = {
  fadeIn: { opacity: [0, 1] },
  fadeOut: { opacity: [1, 0] },
  riseIn: { opacity: [0, 1], transform: ['translateY(6px)', 'translateY(0px)'] },
  dropIn: { opacity: [0, 1], transform: ['translateY(-6px)', 'translateY(0px)'] },
  slideInLeft: { opacity: [0, 1], transform: ['translateX(-10px)', 'translateX(0px)'] },
  slideInRight: { opacity: [0, 1], transform: ['translateX(10px)', 'translateX(0px)'] },
  popIn: { opacity: [0, 1], transform: ['scale(0.92)', 'scale(1)'] },
  popOut: { opacity: [1, 0], transform: ['scale(1)', 'scale(0.96)'] },
  blurIn: { opacity: [0, 1], filter: ['blur(6px)', 'blur(0px)'] },
} as const

export type MotionPreset = keyof typeof presets

const reducedQuery = '(prefers-reduced-motion: reduce)'

type EnterOptions = AnimationOptions & { readonly stagger?: number }
type CountOptions = AnimationOptions & { readonly format?: (value: number) => string }

/** `Array.isArray` cannot narrow a readonly array out of a union; this guard can. */
function isElementList(target: Element | readonly Element[]): target is readonly Element[] {
  return Array.isArray(target)
}

/** The motion helpers every animated component shares. Short aliases (`motionSafe`, `enter`, …) are exported below. */
export class Motion {
  /** Whether the user asked the OS for reduced motion. Safe outside a browser (returns false). */
  static reducedMotion(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(reducedQuery).matches
  }

  /**
   * Animation options that respect reduced motion: the same call ends at its final keyframe instantly.
   * Every helper here routes through it; call it yourself when using `animate` directly.
   */
  static safe<T extends AnimationOptions>(options: T): T {
    if (!Motion.reducedMotion()) return options
    // SAFETY: only timing fields change; the keyframe-facing shape of T is preserved.
    return { ...options, type: undefined, duration: 0, delay: 0 } as T
  }

  /** Run a preset on one element or a list (staggered). Returns the playback controls, or null when nothing matched. */
  static enter(
    target: Element | readonly Element[] | null | undefined,
    preset: MotionPreset = 'riseIn',
    options: EnterOptions = {},
  ): AnimationPlaybackControls | null {
    if (target == null) return null
    const elements: readonly Element[] = isElementList(target) ? target : [target]
    if (elements.length === 0) return null
    const { stagger: step, ...rest } = options
    const timing: AnimationOptions = { ...springs.smooth, ...rest }
    if (step !== undefined) {
      const base = typeof rest.delay === 'number' ? rest.delay : 0
      timing.delay = (index: number) => base + index * step
    }
    return animate([...elements], presets[preset], Motion.safe(timing))
  }

  /**
   * Animate a number from `from` to `to`, calling `render` on each frame (count-ups for tokens, cost, durations).
   * `format` defaults to an integer with locale grouping.
   */
  static countTo(from: number, to: number, render: (value: number, text: string) => void, options: CountOptions = {}): AnimationPlaybackControls {
    const { format = (value: number) => Math.round(value).toLocaleString(), ...rest } = options
    // SAFETY: AnimationOptions and ValueAnimationTransition<number> share every timing field used here.
    const timing = Motion.safe({ duration: durations.slower, ease: easings.out, ...rest }) as ValueAnimationTransition<number>
    return animate(from, to, { ...timing, onUpdate: (value: number) => render(value, format(value)) })
  }

  /** Draw an SVG stroke in (path, line, polyline, circle): sets the dash to the measured length and animates the offset. */
  static drawStroke(path: SVGGeometryElement, options: AnimationOptions = {}): AnimationPlaybackControls {
    const length = path.getTotalLength()
    path.style.strokeDasharray = `${length}`
    path.style.strokeDashoffset = `${length}`
    return animate(path, { strokeDashoffset: [length, 0] }, Motion.safe({ duration: durations.slower, ease: easings.inOut, ...options }))
  }

  /**
   * FLIP the layout change `update` makes inside `scope`: children tagged `data-layout` (or `data-layout-id` to morph
   * between two elements) animate from their old box to the new one. Use for reorders, expands and moving pills.
   */
  static flip(scope: Element, update: () => void, options: AnimationOptions = springs.smooth) {
    return animateLayout(scope, update, Motion.safe(options))
  }

  /**
   * Call `tick(elapsedSeconds, deltaSeconds)` every animation frame until the returned stop function runs.
   * Use it for live surfaces (a running trace bar, a ticking timer) instead of setInterval.
   */
  static everyFrame(tick: (elapsed: number, delta: number) => void): () => void {
    let start: number | undefined
    let last = 0
    const step = ({ timestamp }: { readonly timestamp: number }) => {
      start ??= timestamp
      const elapsed = (timestamp - start) / 1000
      tick(elapsed, elapsed - last)
      last = elapsed
    }
    frame.update(step, true)
    return () => cancelFrame(step)
  }
}

/* Short names for the Motion statics, so component code reads like the Motion docs. */
export const prefersReducedMotion: typeof Motion.reducedMotion = Motion.reducedMotion
export const motionSafe: typeof Motion.safe = Motion.safe
export const enter: typeof Motion.enter = Motion.enter
export const countTo: typeof Motion.countTo = Motion.countTo
export const drawStroke: typeof Motion.drawStroke = Motion.drawStroke
export const flip: typeof Motion.flip = Motion.flip
export const everyFrame: typeof Motion.everyFrame = Motion.everyFrame
