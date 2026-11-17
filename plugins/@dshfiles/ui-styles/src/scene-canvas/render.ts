import { Affine, IDENTITY, type Matrix } from './matrix.js'
import type { LayerItem, MotionNode, SceneItem, SceneModel, Track, VectorItem } from './model.js'

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Surface = OffscreenCanvas

/** Makes an offscreen surface for layers and dot batches. */
export type SurfaceFactory = (width: number, height: number) => Surface

/** One track's value at `time` ms into the scene, written to `out` from `at`. */
function sample(track: Track, time: number, out: Float64Array, at = 0): void {
  const { period, count, stride, values } = track
  let phase = track.loop ? ((time % period) + period) % period : Math.min(Math.max(time, 0), period)
  if (!track.loop && phase >= period) phase = period - 1e-6
  const position = (phase / period) * count
  const index = Math.min(count - 1, Math.floor(position))
  // Sample `count` is the value as the period ends: the last step blends into it, and the next period starts over from
  // sample 0 without sliding back.
  const next = index + 1
  const blend = track.hold ? 0 : position - index
  for (let component = 0; component < stride; component += 1) {
    const from = values[index * stride + component] ?? 0
    const to = values[next * stride + component] ?? from
    out[at + component] = from + (to - from) * blend
  }
}

const scratch = new Float64Array(6)
const valueAt = (value: Track | number, time: number): number => {
  if (typeof value === 'number') return value
  sample(value, time, scratch)
  return scratch[0] ?? 0
}

const isTrack = (value: unknown): value is Track => typeof value === 'object' && value !== null && !Array.isArray(value) && 'count' in value

/** A node's local matrix at `time`. */
function localAt(node: MotionNode, time: number): Matrix {
  let move: readonly [number, number] = isTrack(node.translate) ? [0, 0] : node.translate
  if (isTrack(node.translate)) {
    sample(node.translate, time, scratch)
    move = [scratch[0] ?? 0, scratch[1] ?? 0]
  }
  const turn = isTrack(node.rotate) ? valueAt(node.rotate, time) : node.rotate
  let size: readonly [number, number] = isTrack(node.scale) ? [1, 1] : node.scale
  if (isTrack(node.scale)) {
    sample(node.scale, time, scratch)
    size = [scratch[0] ?? 1, scratch[1] ?? 1]
  }
  let transform: Matrix = isTrack(node.transform) ? IDENTITY : node.transform
  if (isTrack(node.transform)) {
    sample(node.transform, time, scratch)
    transform = [scratch[0] ?? 1, scratch[1] ?? 0, scratch[2] ?? 0, scratch[3] ?? 1, scratch[4] ?? 0, scratch[5] ?? 0]
  }
  return Affine.local(node.origin, move, turn, size, transform)
}

/** Whether a node or one of its ancestors moves or fades. */
function live(nodes: readonly MotionNode[], node: number): boolean {
  for (let index = node; index >= 0; index = nodes[index]?.parent ?? -1)
    if ((nodes[index]?.moves ?? false) || (nodes[index]?.alpha.length ?? 0) > 0) return true
  return false
}

/** Whether a subtree of items has anything that changes over time. */
function animated(items: readonly SceneItem[], nodes: readonly MotionNode[]): boolean {
  return items.some(item => {
    if (live(nodes, item.node) || item.alpha.length > 0) return true
    if (item.kind === 'vector') return isTrack(item.width) || isTrack(item.dashOffset)
    if (item.kind === 'layer') return animated(item.items, nodes)
    return false
  })
}

interface Batch {
  readonly items: VectorItem[]
  readonly surface: Surface
  readonly context: Context2D
  /** Per item: its dot centres in device pixels, the device radius per unit of stroke width, and its last width. */
  readonly state: { centres: Float32Array; unit: number; width: number }[]
  /** Whether erasing one dot can touch another at this scale. */
  retained: boolean
  fresh: boolean
}

/** Gap in device pixels a dot batch needs to be updated dot by dot: antialiasing reaches about half a pixel out. */
const RETAIN_GAP = 1.5

/**
 * Draws a compiled scene on a 2D canvas. Each frame it places the scene's pictures where their tracks say, strokes the
 * vectors and composites the layers; nothing is rasterised again, so a frame costs a few image draws.
 */
export class SceneRenderer {
  readonly #context: Context2D
  readonly #surface: SurfaceFactory
  #model: SceneModel | null = null
  #bitmaps: readonly ImageBitmap[] = []
  #view: Matrix = IDENTITY
  #width = 0
  #height = 0
  #moves: Matrix[] = []
  #alphas: number[] = []
  #layers: { surface: Surface; context: Context2D }[] = []
  #paths = new Map<VectorItem, Path2D>()
  #batches = new Map<number, Batch>()
  #staticLayers = new Map<LayerItem, { surface: Surface; context: Context2D }>()
  /** Layers whose content and matte never change. */
  #stillLayers = new Set<LayerItem>()
  #vectors: VectorItem[] = []
  #signature: Float64Array = new Float64Array(0)
  #dirty = true

  constructor(context: Context2D, surface: SurfaceFactory) {
    this.#context = context
    this.#surface = surface
  }

  setScene(model: SceneModel | null, bitmaps: readonly ImageBitmap[]): void {
    for (const bitmap of this.#bitmaps) bitmap.close()
    this.#model = model
    this.#bitmaps = bitmaps
    this.#paths.clear()
    this.#batches.clear()
    this.#staticLayers.clear()
    this.#stillLayers.clear()
    this.#vectors = []
    this.#dirty = true
    if (model === null) return
    for (const item of walk(model.items)) {
      if (item.kind === 'vector') {
        this.#vectors.push(item)
        if (item.path !== undefined) this.#paths.set(item, new Path2D(item.path))
      }
      if (item.kind === 'layer' && !animated(item.items, model.nodes) && !live(model.nodes, item.node)) this.#stillLayers.add(item)
    }
  }

  /** The canvas size in device pixels, and the matrix from scene units to them. */
  setView(width: number, height: number, view: Matrix): void {
    this.#width = width
    this.#height = height
    this.#view = view
    for (const layer of this.#layers) {
      layer.surface.width = width
      layer.surface.height = height
    }
    this.#staticLayers.clear()
    this.#batches.clear()
    this.#dirty = true
  }

  /** Whether the scene changes over time at all. */
  get still(): boolean {
    return this.#model?.still ?? true
  }

  /** Draws the scene at `time` ms; skips the frame when nothing changed since the last one. Returns whether it drew. */
  draw(time: number): boolean {
    const model = this.#model
    if (model === null || this.#width === 0 || this.#height === 0) return false
    this.#evaluate(model, time)
    const signature = this.#sign(model, time)
    if (!this.#dirty && signature.length === this.#signature.length && signature.every((value, index) => value === this.#signature[index])) return false
    // The previous signature becomes the buffer of the next frame.
    this.#spare = this.#signature
    this.#signature = signature
    this.#dirty = false
    const context = this.#context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.clearRect(0, 0, this.#width, this.#height)
    this.#drawItems(context, model.items, 0, time)
    return true
  }

  #evaluate(model: SceneModel, time: number): void {
    const { nodes } = model
    this.#moves.length = nodes.length
    this.#alphas.length = nodes.length
    nodes.forEach((node, index) => {
      const own = node.moves ? Affine.multiply(Affine.multiply(node.before, localAt(node, time)), node.after) : IDENTITY
      const parent = node.parent >= 0 ? this.#moves[node.parent] : undefined
      this.#moves[index] = parent === undefined ? own : Affine.multiply(parent, own)
      let alpha = 1
      for (const track of node.alpha) alpha *= valueAt(track, time)
      this.#alphas[index] = alpha
    })
  }

  /** Every value a frame depends on, to skip frames where none changed (a scene that steps, a still one). */
  #sign(model: SceneModel, time: number): Float64Array {
    const size = model.nodes.length * 7 + this.#vectors.length * 2
    if (this.#spare.length !== size || this.#spare === this.#signature) this.#spare = new Float64Array(size)
    const values = this.#spare
    let at = 0
    for (const move of this.#moves) for (const value of move) values[at++] = value
    for (const alpha of this.#alphas) values[at++] = alpha
    for (const item of this.#vectors) {
      values[at++] = valueAt(item.width, time)
      values[at++] = valueAt(item.dashOffset, time)
    }
    return values
  }

  #spare: Float64Array = new Float64Array(0)

  #matrix(node: number): Matrix {
    const move = node >= 0 ? this.#moves[node] : undefined
    return move === undefined ? this.#view : Affine.multiply(this.#view, move)
  }

  #alpha(nodes: readonly number[]): number {
    let alpha = 1
    for (const node of nodes) alpha *= this.#alphas[node] ?? 1
    return alpha
  }

  #layer(depth: number): { surface: Surface; context: Context2D } {
    let layer = this.#layers[depth]
    if (layer === undefined) {
      const surface = this.#surface(this.#width, this.#height)
      const context = surface.getContext('2d')
      if (context === null) throw new Error('no 2D context for a scene layer')
      layer = { surface, context }
      this.#layers[depth] = layer
    }
    return layer
  }

  #drawItems(context: Context2D, items: readonly SceneItem[], depth: number, time: number): void {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item === undefined) continue
      if (item.kind === 'sprite') {
        const bitmap = this.#bitmaps[item.sprite]
        if (bitmap === undefined) continue
        const alpha = this.#alpha(item.alpha)
        if (alpha <= 0) continue
        context.setTransform(...this.#matrix(item.node))
        context.globalAlpha = alpha
        context.drawImage(bitmap, item.rect[0], item.rect[1], item.rect[2], item.rect[3])
      } else if (item.kind === 'vector') {
        if (item.batch >= 0) {
          // One draw for the whole batch, at its first item.
          const previous = items[index - 1]
          if (previous?.kind === 'vector' && previous.batch === item.batch) continue
          this.#drawBatch(context, item.batch, items, index, time)
          continue
        }
        this.#drawVector(context, item, time)
      } else this.#drawLayer(context, item, depth, time)
    }
  }

  #drawVector(context: Context2D, item: VectorItem, time: number): void {
    const alpha = this.#alpha(item.alpha)
    if (alpha <= 0) return
    const width = valueAt(item.width, time)
    context.setTransform(...Affine.multiply(this.#matrix(item.node), item.matrix))
    if (item.dots !== undefined) {
      const paint = item.stroke
      if (paint === null || width <= 0) return
      context.globalAlpha = alpha * paint.opacity
      context.fillStyle = paint.color
      context.beginPath()
      dotPath(context, item.dots, width / 2, item.cap)
      context.fill()
      return
    }
    const path = this.#paths.get(item)
    if (path === undefined) return
    if (item.fill !== null) {
      context.globalAlpha = alpha * item.fill.opacity
      context.fillStyle = item.fill.color
      context.fill(path)
    }
    if (item.stroke !== null && width > 0) {
      context.globalAlpha = alpha * item.stroke.opacity
      context.strokeStyle = item.stroke.color
      context.lineWidth = width
      context.lineCap = item.cap
      context.lineJoin = item.join
      context.miterLimit = item.miter
      context.setLineDash(item.dash ?? [])
      context.lineDashOffset = valueAt(item.dashOffset, time) * item.dashScale
      context.stroke(path)
      context.setLineDash([])
    }
  }

  #drawLayer(context: Context2D, item: LayerItem, depth: number, time: number): void {
    const alpha = this.#alpha(item.alpha) * item.opacity
    if (alpha <= 0) return
    const surface = this.#layerContent(item, depth, time)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = alpha
    context.globalCompositeOperation = item.blend
    context.drawImage(surface, 0, 0)
    context.globalCompositeOperation = 'source-over'
  }

  /** The layer's content cut by its matte. A layer whose content never changes is drawn once per view. */
  #layerContent(item: LayerItem, depth: number, time: number): Surface {
    const still = this.#stillLayers.has(item)
    if (still) {
      const cached = this.#staticLayers.get(item)
      if (cached !== undefined) return cached.surface
    }
    const target = still
      ? (() => {
          const surface = this.#surface(this.#width, this.#height)
          const context = surface.getContext('2d')
          if (context === null) throw new Error('no 2D context for a scene layer')
          return { surface, context }
        })()
      : this.#layer(depth)
    const inner = target.context
    inner.setTransform(1, 0, 0, 1, 0, 0)
    inner.globalAlpha = 1
    inner.globalCompositeOperation = 'source-over'
    inner.clearRect(0, 0, this.#width, this.#height)
    this.#drawItems(inner, item.items, depth + 1, time)
    if (item.matte !== null) {
      const matte = this.#bitmaps[item.matte.sprite]
      if (matte !== undefined) {
        inner.setTransform(...this.#matrix(item.node))
        inner.globalAlpha = 1
        // Keeps the layer only where the clip or mask lets it through, and clears everything outside the matte.
        inner.globalCompositeOperation = 'destination-in'
        inner.drawImage(matte, item.matte.rect[0], item.matte.rect[1], item.matte.rect[2], item.matte.rect[3])
        inner.globalCompositeOperation = 'source-over'
      }
    }
    if (still) this.#staticLayers.set(item, target)
    return target.surface
  }

  /**
   * A retained dot batch: its dots live on their own layer. When an item's width changes, only its dots are erased and
   * drawn again (dots never overlap, checked at compile time), so a frame costs the dots that changed, not all of them.
   */
  #drawBatch(context: Context2D, id: number, items: readonly SceneItem[], start: number, time: number): void {
    let batch = this.#batches.get(id)
    if (batch === undefined) {
      const members: VectorItem[] = []
      for (let index = start; index < items.length; index += 1) {
        const item = items[index]
        if (item?.kind !== 'vector' || item.batch !== id) break
        members.push(item)
      }
      const surface = this.#surface(this.#width, this.#height)
      const batchContext = surface.getContext('2d')
      if (batchContext === null) throw new Error('no 2D context for a dot batch')
      const state = members.map(item => {
        const matrix = Affine.multiply(this.#view, item.matrix)
        const dots = item.dots ?? new Float32Array()
        const centres = new Float32Array(dots.length)
        for (let index = 0; index + 1 < dots.length; index += 2) {
          const [x, y] = Affine.apply(matrix, dots[index] ?? 0, dots[index + 1] ?? 0)
          centres[index] = x
          centres[index + 1] = y
        }
        return { centres, unit: Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])), width: -1 }
      })
      const unit = state[0]?.unit ?? 1
      const gap = (this.#model?.batches[id] ?? 0) * Math.sqrt(Math.abs(this.#view[0] * this.#view[3] - this.#view[1] * this.#view[2]))
      batch = { items: members, surface, context: batchContext, state, retained: gap >= RETAIN_GAP && unit > 0, fresh: true }
      this.#batches.set(id, batch)
    }
    const target = batch.context
    target.setTransform(1, 0, 0, 1, 0, 0)
    const widths = batch.items.map(item => valueAt(item.width, time))
    const changed = widths.some((width, index) => width !== batch.state[index]?.width)
    if (batch.fresh || (changed && !batch.retained)) {
      target.globalCompositeOperation = 'source-over'
      target.clearRect(0, 0, this.#width, this.#height)
      batch.items.forEach((item, index) => this.#paintDots(target, item, batch.state[index], widths[index] ?? 0))
      batch.fresh = false
    } else if (changed)
      batch.items.forEach((item, index) => {
        const state = batch.state[index]
        const width = widths[index] ?? 0
        if (state === undefined || state.width === width) return
        // Erase the old dots, a little wider than they were, then paint the new ones.
        target.globalCompositeOperation = 'destination-out'
        target.globalAlpha = 1
        target.fillStyle = '#000'
        target.beginPath()
        dotPath(target, state.centres, (state.width * state.unit) / 2 + 0.75, item.cap)
        target.fill()
        target.globalCompositeOperation = 'source-over'
        this.#paintDots(target, item, state, width)
      })
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1
    context.drawImage(batch.surface, 0, 0)
  }

  #paintDots(target: Context2D, item: VectorItem, state: Batch['state'][number] | undefined, width: number): void {
    if (state === undefined) return
    state.width = width
    if (item.stroke === null || width <= 0) return
    target.globalAlpha = item.stroke.opacity
    target.fillStyle = item.stroke.color
    target.beginPath()
    dotPath(target, state.centres, (width * state.unit) / 2, item.cap)
    target.fill()
  }
}

/** Adds one disc (round cap) or square (square cap) per dot centre to the current path. */
function dotPath(context: Context2D, centres: Float32Array, radius: number, cap: CanvasLineCap): void {
  if (radius <= 0) return
  for (let index = 0; index + 1 < centres.length; index += 2) {
    const x = centres[index] ?? 0
    const y = centres[index + 1] ?? 0
    if (cap === 'square') context.rect(x - radius, y - radius, 2 * radius, 2 * radius)
    else {
      context.moveTo(x + radius, y)
      context.arc(x, y, radius, 0, Math.PI * 2)
    }
  }
}

/** Every item of a tree, layers' contents included. */
function* walk(items: readonly SceneItem[]): Generator<SceneItem> {
  for (const item of items) {
    yield item
    if (item.kind === 'layer') yield* walk(item.items)
  }
}

/** The pure parts of the renderer, for tests. */
export class SceneMath {
  static readonly sample = sample
  static readonly localAt = localAt
}
