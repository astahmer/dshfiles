import type { Matrix } from './matrix.js'

/**
 * A backdrop scene compiled for the canvas: what to draw, in paint order, and how each part moves. It holds only plain
 * data and typed arrays, so it crosses to the scene worker as is; the pictures travel beside it as `ImageBitmap`s.
 *
 * The compiler (`compile.ts`) reads the scene's SVG once in the page: each moving part becomes a still picture (a
 * sprite) or, for the few effects a picture cannot carry (a line that draws itself, dots that swell), a vector the
 * renderer strokes; each CSS animation becomes a track of sampled values. The renderer (`render.ts`) then only places
 * those pictures each frame, which costs a fraction of re-rasterising the SVG.
 */

/** `[x, y, width, height]` in scene units (the SVG viewBox). */
export type Rect = readonly [number, number, number, number]

/**
 * One animated value over one period of its animation, sampled at even steps: `values[i * stride + c]` is component `c`
 * of sample `i`. Between samples the renderer interpolates, or holds the previous sample when the animation steps.
 */
export interface Track {
  /** Milliseconds after which the values repeat (an alternate animation's period is two iterations). */
  readonly period: number
  readonly count: number
  readonly stride: number
  /** The animation uses `steps()`: hold each sample rather than blend into the next. */
  readonly hold: boolean
  /** The values repeat forever; otherwise the last one holds after `period`. */
  readonly loop: boolean
  readonly values: Float32Array
}

/**
 * An animated element: how its own transform and opacity move. A part it carries moves by `before · L(t) · after`, with
 * `L(t)` its local matrix at time `t` (origin, translate, rotate, scale, transform) and `before`/`after` fixed, times
 * the same for each animated ancestor (`parent`).
 */
export interface MotionNode {
  /** The nearest animated ancestor, or -1. */
  readonly parent: number
  readonly origin: readonly [number, number]
  readonly translate: Track | readonly [number, number]
  readonly rotate: Track | number
  readonly scale: Track | readonly [number, number]
  readonly transform: Track | Matrix
  /** Whether any of the four transform parts is animated. */
  readonly moves: boolean
  /** The parent's matrix to the scene at rest. */
  readonly before: Matrix
  /** The inverse of the local matrix at rest, then of `before`. */
  readonly after: Matrix
  /** Opacity, fill-opacity and stroke-opacity tracks: the part is drawn at their product. */
  readonly alpha: readonly Track[]
}

/** A still picture, placed over `rect`. */
export interface SpriteItem {
  readonly kind: 'sprite'
  /** The motion node it moves with, or -1. */
  readonly node: number
  /** Motion nodes whose alpha it is drawn at. */
  readonly alpha: readonly number[]
  readonly sprite: number
  readonly rect: Rect
}

export interface Paint {
  /** A CSS colour. */
  readonly color: string
  readonly opacity: number
}

/** A stroked (and filled) path drawn each frame, for the properties a picture cannot animate. */
export interface VectorItem {
  readonly kind: 'vector'
  readonly node: number
  readonly alpha: readonly number[]
  /** The element's matrix to the scene at rest. */
  readonly matrix: Matrix
  /** SVG path data; absent for dots. */
  readonly path?: string
  /** Dot centres `[x0, y0, x1, y1, …]`: a path of zero-length segments with round or square caps. */
  readonly dots?: Float32Array
  readonly stroke: Paint | null
  readonly fill: Paint | null
  readonly width: Track | number
  /** Dash pattern in path units; null for a solid line. */
  readonly dash: readonly number[] | null
  readonly dashOffset: Track | number
  /** Factor from the animated or computed dash values to path units (`pathLength`). */
  readonly dashScale: number
  readonly cap: CanvasLineCap
  readonly join: CanvasLineJoin
  readonly miter: number
  /**
   * The retained dot batch it is drawn in (an index of `SceneModel.batches`), or -1. A batch is a run of dot items that
   * only change size and never overlap, so the renderer keeps them on a layer and redraws only the dots that changed.
   */
  readonly batch: number
}

/**
 * A group composited on its own, as the browser does for an element with opacity, a clip, a mask or a blend mode whose
 * content moves inside it: its items are drawn on a layer, cut by the matte (the clip or mask as a picture), then
 * composited at its opacity and blend mode.
 */
export interface LayerItem {
  readonly kind: 'layer'
  /** The motion node the matte moves with, or -1. */
  readonly node: number
  readonly alpha: readonly number[]
  readonly opacity: number
  readonly blend: GlobalCompositeOperation
  readonly matte: { readonly sprite: number; readonly rect: Rect } | null
  readonly items: readonly SceneItem[]
}

export type SceneItem = SpriteItem | VectorItem | LayerItem

export interface SceneModel {
  readonly viewBox: Rect
  readonly nodes: readonly MotionNode[]
  readonly items: readonly SceneItem[]
  /** Number of sprite pictures the items refer to. */
  readonly sprites: number
  /** Per dot batch: the smallest gap between two of its dots at their largest, in scene units. */
  readonly batches: readonly number[]
  /** No track at all: one frame is the whole scene. */
  readonly still: boolean
}

/** A message to the scene worker. */
export type WorkerMessage =
  | { readonly type: 'canvas'; readonly canvas: OffscreenCanvas }
  | { readonly type: 'scene'; readonly model: SceneModel | null; readonly bitmaps: readonly ImageBitmap[] }
  | { readonly type: 'view'; readonly width: number; readonly height: number; readonly matrix: Matrix }
  | { readonly type: 'run'; readonly running: boolean; readonly frameRate: number }
