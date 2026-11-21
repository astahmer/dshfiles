import { Affine, IDENTITY, type Matrix } from './matrix.js'
import type { LayerItem, MotionNode, Paint, Rect, SceneItem, SceneModel, SpriteItem, Track, VectorItem } from './model.js'
import { SceneMath } from './render.js'

/**
 * Compiles an animated SVG scene for the canvas renderer, in the page (it needs the browser's CSS engine):
 *
 * 1. The SVG is mounted hidden, with its animations off, to read every element's resting matrix, effects and bounds.
 * 2. Its CSS animations are switched back on, paused, and sampled: each animated property of each element becomes a
 *    track of values over one period, read from the computed style, so `var()`, `calc()` and every easing resolve
 *    exactly as the browser would.
 * 3. The paint order is cut into items: runs of parts that move together become sprites (pictures rasterised once from
 *    the same SVG), parts whose stroke width or dash moves become vectors, and groups whose opacity, clip, mask or blend
 *    mode covers moving parts become layers.
 *
 * The plan holds each sprite's SVG markup; `rasterizePlan` turns it into pictures at the screen's scale.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Elements that never paint where they stand: they are copied once into each atlas page's `<defs>`. */
const RESOURCES = new Set(['defs', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'marker', 'symbol'])
const SKIPPED = new Set(['style', 'title', 'desc', 'metadata', 'script'])
const CONTAINERS = new Set(['g', 'a', 'switch'])

const TRANSFORM_PROPS = ['transform', 'translate', 'rotate', 'scale'] as const
const ALPHA_PROPS = ['opacity', 'fillOpacity', 'strokeOpacity'] as const
const VECTOR_PROPS = ['strokeWidth', 'strokeDashoffset'] as const
type TransformProp = (typeof TRANSFORM_PROPS)[number]
type AlphaProp = (typeof ALPHA_PROPS)[number]
type VectorProp = (typeof VECTOR_PROPS)[number]
type Prop = TransformProp | AlphaProp | VectorProp
const PROPS: readonly string[] = [...TRANSFORM_PROPS, ...ALPHA_PROPS, ...VECTOR_PROPS]
const isProp = (name: string): name is Prop => PROPS.includes(name)
/** CSS names of the alpha properties, for the inline overrides of the atlas. */
const ALPHA_CSS = { opacity: 'opacity', fillOpacity: 'fill-opacity', strokeOpacity: 'stroke-opacity' } satisfies Readonly<Record<AlphaProp, string>>

/** Samples per second of animation, and the bounds of one track. */
const SAMPLE_RATE = 24
const MIN_SAMPLES = 24
const MAX_SAMPLES = 1440
/** How long before the end of its period a track's last sample is read, in ms: the value as it ends, not its restart. */
const END_BEFORE = 0.01
/** Times at which a motion is sampled to find what it brings on screen. */
const REACH_SAMPLES = 720
/** How long the compiler works before it yields to the page, in ms. */
const SLICE = 24

/** A scene the compiler cannot draw on the canvas; the page shows its resting picture instead. */
export class SceneCompileError extends Error {
  override readonly name = 'SceneCompileError'
}

/** One sprite to rasterise: its bounds in scene units and the SVG markup of its content. */
export interface PlannedCell {
  readonly rect: Rect
  readonly markup: string
}

/** A compiled scene: the renderer's model, and the markup its sprites are rasterised from. */
export interface ScenePlan {
  readonly model: SceneModel
  readonly cells: readonly PlannedCell[]
  /** Scene styles, animations off: the head of every atlas page. */
  readonly style: string
  /** Every resource (gradients, patterns, clips, masks, referenced shapes), with its id. */
  readonly defs: string
  /** The scene root's own attributes (fonts, colours), set on every atlas page. */
  readonly rootAttributes: string
}

interface Base {
  readonly local: Matrix
  readonly ctm: Matrix
  readonly origin: readonly [number, number]
  readonly translate: readonly [number, number]
  readonly rotate: number
  readonly scale: readonly [number, number]
  readonly transform: Matrix
  readonly opacity: number
  readonly effects: boolean
  readonly blend: string
}

/** The paint of a part at rest, for a part drawn as a vector. */
interface RestStyle {
  readonly stroke: string
  readonly fill: string
  readonly strokeOpacity: string
  readonly fillOpacity: string
  readonly opacity: string
  readonly strokeWidth: string
  readonly strokeDasharray: string
  readonly strokeDashoffset: string
  readonly strokeLinecap: string
  readonly strokeLinejoin: string
  readonly strokeMiterlimit: string
}

function readPaint(style: CSSStyleDeclaration): RestStyle {
  return {
    stroke: style.stroke,
    fill: style.fill,
    strokeOpacity: style.strokeOpacity,
    fillOpacity: style.fillOpacity,
    opacity: style.opacity,
    strokeWidth: style.strokeWidth,
    strokeDasharray: style.strokeDasharray,
    strokeDashoffset: style.strokeDashoffset,
    strokeLinecap: style.strokeLinecap,
    strokeLinejoin: style.strokeLinejoin,
    strokeMiterlimit: style.strokeMiterlimit,
  }
}

interface Sampled {
  readonly animation: Animation
  readonly element: Element
  readonly prop: Prop
  readonly period: number
  readonly count: number
  readonly loop: boolean
  readonly hold: boolean
  readonly stride: number
  readonly values: Float32Array
}

const STRIDE = {
  transform: 6,
  translate: 2,
  rotate: 1,
  scale: 2,
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  strokeWidth: 1,
  strokeDashoffset: 1,
} satisfies Readonly<Record<Prop, number>>

function read(style: CSSStyleDeclaration, prop: Prop, into: Float32Array, at: number): void {
  switch (prop) {
    case 'transform':
      into.set(Affine.parseTransform(style.transform), at)
      return
    case 'translate':
      into.set(Affine.parseTranslate(style.translate), at)
      return
    case 'scale':
      into.set(Affine.parseScale(style.scale), at)
      return
    case 'rotate':
      into[at] = Affine.parseRotate(style.rotate)
      return
    default:
      into[at] = Number.parseFloat(style[prop]) || 0
  }
}

const BLENDS: readonly GlobalCompositeOperation[] = [
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]

/** A CSS `mix-blend-mode` as the canvas composite operation that draws it; `normal` is plain source-over. */
function blendOf(mode: string | undefined): GlobalCompositeOperation {
  return BLENDS.find(blend => blend === mode) ?? 'source-over'
}

/** Hands the page back between slices of work. */
const breather = (): (() => Promise<void>) => {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < SLICE) return
    await new Promise<void>(resolve => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => resolve()
      channel.port2.postMessage(null)
    })
    since = performance.now()
  }
}

const isResource = (element: Element): boolean => RESOURCES.has(element.localName)
const isLeaf = (element: Element): boolean => !CONTAINERS.has(element.localName) && !isResource(element) && !SKIPPED.has(element.localName)

/** Bounds of an element in scene units, widened by half its stroke so a stroke's edge and a dot's cap are inside. */
function bounds(element: Element, svgBox: DOMRect, viewBox: Rect, ctm: Matrix, style: CSSStyleDeclaration): Rect | undefined {
  const box = element.getBoundingClientRect()
  const stroke = style.stroke === 'none' ? 0 : Number.parseFloat(style.strokeWidth) || 0
  const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]))
  const margin = (stroke * scale) / 2 + 2
  if (box.width === 0 && box.height === 0 && stroke === 0) return undefined
  return [box.left - svgBox.left + viewBox[0] - margin, box.top - svgBox.top + viewBox[1] - margin, box.width + 2 * margin, box.height + 2 * margin]
}

function union(a: Rect | undefined, b: Rect): Rect {
  if (a === undefined) return b
  const left = Math.min(a[0], b[0])
  const top = Math.min(a[1], b[1])
  return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top]
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const left = Math.max(a[0], b[0])
  const top = Math.max(a[1], b[1])
  const right = Math.min(a[0] + a[2], b[0] + b[2])
  const bottom = Math.min(a[1] + a[3], b[1] + b[3])
  return right > left && bottom > top ? [left, top, right - left, bottom - top] : undefined
}

const grow = (rect: Rect, by: number): Rect => [rect[0] - by * rect[2], rect[1] - by * rect[3], rect[2] * (1 + 2 * by), rect[3] * (1 + 2 * by)]

/** A computed colour as a canvas paint, or undefined for `none`; a paint server (`url(...)`) is not supported. */
function paint(value: string, opacity: number): Paint | null {
  if (value === 'none' || value === '' || opacity <= 0) return null
  if (value.includes('url(')) throw new SceneCompileError(`a moving stroke painted with ${value}`)
  return { color: value, opacity }
}

/** A path made only of zero-length segments (`M x y h0` …): with a round or square cap, a row of dots. */
const DOTS = /^(?:\s*M\s*-?[\d.]+(?:e[-+]?\d+)?[\s,]+-?[\d.]+(?:e[-+]?\d+)?\s*(?:h\s*0|v\s*0)\s*)+$/iu

function dotsOf(path: string): Float32Array {
  const values = [...path.matchAll(/M\s*(-?[\d.]+(?:e[-+]?\d+)?)[\s,]+(-?[\d.]+(?:e[-+]?\d+)?)/giu)].flatMap(match => [Number(match[1]), Number(match[2])])
  return Float32Array.from(values)
}

function strip(element: Element): void {
  element.removeAttribute('id')
  for (const child of element.querySelectorAll('[id]')) child.removeAttribute('id')
}

function addStyle(element: Element, declarations: readonly string[]): void {
  if (declarations.length === 0) return
  const own = element.getAttribute('style') ?? ''
  element.setAttribute('style', `${own}${own === '' || own.trimEnd().endsWith(';') ? '' : ';'}${declarations.map(rule => `${rule}!important`).join(';')}`)
}

/** Reads a scene and plans its canvas model. `doc` is the page's document; the scene is mounted hidden and removed. */
export async function planScene(svg: string, doc: Document): Promise<ScenePlan> {
  const host = doc.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-200000px;top:0;opacity:0;pointer-events:none;contain:strict;overflow:hidden'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = svg
  const root = shadow.querySelector('svg')
  if (root === null) throw new SceneCompileError('the scene has no <svg> root')
  const box = root.viewBox.baseVal
  const viewBox: Rect = box !== null && box.width > 0 ? [box.x, box.y, box.width, box.height] : [0, 0, 1600, 1000]
  root.setAttribute('width', String(viewBox[2]))
  root.setAttribute('height', String(viewBox[3]))
  root.setAttribute('preserveAspectRatio', 'none')
  root.style.cssText = 'position:absolute;left:0;top:0;display:block'
  host.style.width = `${viewBox[2]}px`
  host.style.height = `${viewBox[3]}px`
  const off = doc.createElement('style')
  off.textContent = '*{animation-name:none!important;transition:none!important}'
  shadow.append(off)
  doc.body.append(host)
  try {
    return await measure(root, shadow, off, viewBox)
  } finally {
    host.remove()
  }
}

async function measure(root: Element, shadow: ShadowRoot, off: HTMLStyleElement, viewBox: Rect): Promise<ScenePlan> {
  const yieldNow = breather()
  // 1. At rest: every rendered element's matrix, effects and the bounds of every part.
  const rendered: Element[] = []
  const resources: Element[] = []
  const walk = (parent: Element): void => {
    for (const child of parent.children) {
      if (SKIPPED.has(child.localName)) continue
      if (isResource(child)) {
        resources.push(child)
        continue
      }
      if (child.localName === 'svg') throw new SceneCompileError('a nested <svg> element')
      rendered.push(child)
      if (CONTAINERS.has(child.localName)) walk(child)
    }
  }
  walk(root)
  const svgBox = root.getBoundingClientRect()
  const base = new Map<Element, Base>()
  const rects = new Map<Element, Rect>()
  const restStyle = new Map<Element, RestStyle>()
  for (const element of rendered) {
    const style = getComputedStyle(element)
    const parent = element.parentElement === root || element.parentElement === null ? undefined : base.get(element.parentElement)
    const [ox, oy] = Affine.parseTranslate(style.transformOrigin)
    let origin: readonly [number, number] = [viewBox[0] + ox, viewBox[1] + oy]
    if (style.transformBox === 'fill-box' || style.transformBox === 'stroke-box') {
      const box = element instanceof SVGGraphicsElement ? element.getBBox() : undefined
      origin = [(box?.x ?? 0) + ox, (box?.y ?? 0) + oy]
    }
    const translate = Affine.parseTranslate(style.translate)
    const rotate = Affine.parseRotate(style.rotate)
    const scale = Affine.parseScale(style.scale)
    const transform = Affine.parseTransform(style.transform)
    const local = Affine.local(origin, translate, rotate, scale, transform)
    const ctm = Affine.multiply(parent?.ctm ?? IDENTITY, local)
    const opacity = Number.parseFloat(style.opacity)
    const blend = style.mixBlendMode
    const effects = opacity < 1 || style.clipPath !== 'none' || style.maskImage !== 'none' || blend !== 'normal' || style.filter !== 'none'
    base.set(element, { local, ctm, origin, translate, rotate, scale, transform, opacity, effects, blend })
    if (isLeaf(element) && style.display !== 'none' && style.visibility !== 'hidden') {
      const rect = bounds(element, svgBox, viewBox, ctm, style)
      if (rect !== undefined) rects.set(element, rect)
      restStyle.set(element, readPaint(style))
    }
    await yieldNow()
  }

  // 2. Animations on, paused, sampled together: one style pass per sample index for the whole scene.
  off.remove()
  const animations = root.getAnimations({ subtree: true })
  for (const animation of animations) animation.pause()
  const winners = new Map<Element, Map<Prop, Animation>>()
  for (const animation of animations) {
    const effect = animation.effect
    if (!(effect instanceof KeyframeEffect) || effect.target === null || !base.has(effect.target)) continue
    const props = new Set<string>()
    for (const keyframe of effect.getKeyframes()) for (const key of Object.keys(keyframe)) props.add(key)
    for (const key of ['offset', 'computedOffset', 'easing', 'composite']) props.delete(key)
    for (const key of props) {
      // A keyframe-level timing function is not an animated property.
      if (key === 'animationTimingFunction') continue
      if (!isProp(key)) throw new SceneCompileError(`an animated "${key}"`)
      const own = winners.get(effect.target) ?? new Map<Prop, Animation>()
      own.set(key, animation)
      winners.set(effect.target, own)
    }
  }
  const tracks: Sampled[] = []
  for (const [element, props] of winners)
    for (const [prop, animation] of props) {
      const effect = animation.effect
      if (!(effect instanceof KeyframeEffect)) continue
      const timing = effect.getComputedTiming()
      const duration = typeof timing.duration === 'number' ? timing.duration : 0
      if (!(duration > 0)) continue
      const loop = timing.iterations === Infinity
      const alternate = timing.direction === 'alternate' || timing.direction === 'alternate-reverse'
      const period = loop ? duration * (alternate ? 2 : 1) : Math.max(1, Number(timing.endTime ?? duration))
      const count = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.ceil((period / 1000) * SAMPLE_RATE)))
      const hold = effect.getKeyframes().some(keyframe => (keyframe.easing ?? '').startsWith('steps')) || (timing.easing ?? '').startsWith('steps')
      tracks.push({ animation, element, prop, period, count, loop, hold, stride: STRIDE[prop], values: new Float32Array((count + 1) * STRIDE[prop]) })
    }
  const most = tracks.reduce((max, track) => Math.max(max, track.count), 0)
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const track of tracks) if (!styles.has(track.element)) styles.set(track.element, getComputedStyle(track.element))
  // `count + 1` samples per track: the last is the value just before the period ends, so a loop that restarts from
  // another value (snow falling, then back at the top) jumps there as CSS does instead of sliding back.
  for (let index = 0; index <= most; index += 1) {
    const stepped = new Set<Animation>()
    for (const track of tracks) {
      if (index > track.count || stepped.has(track.animation)) continue
      track.animation.currentTime = index === track.count ? track.period - END_BEFORE : (index * track.period) / track.count
      stepped.add(track.animation)
    }
    for (const track of tracks)
      if (index <= track.count) read(styles.get(track.element) ?? getComputedStyle(track.element), track.prop, track.values, index * track.stride)
    await yieldNow()
  }
  const trackOf = (element: Element, prop: Prop): Track | undefined => {
    const found = tracks.find(track => track.element === element && track.prop === prop)
    return found === undefined
      ? undefined
      : { period: found.period, count: found.count, stride: found.stride, hold: found.hold, loop: found.loop, values: found.values }
  }

  // 3. Motion nodes: every element whose transform or alpha is animated, parents first.
  const nodes: MotionNode[] = []
  const nodeOf = new Map<Element, number>()
  const nodeElements: Element[] = []
  const alphaPropsOf = new Map<Element, AlphaProp[]>()
  const nearestNode = (element: Element | null): number => {
    for (let at = element; at !== null && at !== root; at = at.parentElement) {
      const index = nodeOf.get(at)
      if (index !== undefined) return index
    }
    return -1
  }
  for (const element of rendered) {
    const props = winners.get(element)
    if (props === undefined) continue
    const moving = TRANSFORM_PROPS.filter(prop => props.has(prop))
    const fading = ALPHA_PROPS.filter(prop => props.has(prop))
    if (moving.length === 0 && fading.length === 0) continue
    const rest = base.get(element)
    if (rest === undefined) continue
    const parentCtm = element.parentElement === null || element.parentElement === root ? IDENTITY : (base.get(element.parentElement)?.ctm ?? IDENTITY)
    const pick = <T>(prop: TransformProp, still: T): Track | T => trackOf(element, prop) ?? still
    alphaPropsOf.set(element, fading)
    nodeOf.set(element, nodes.length)
    nodeElements.push(element)
    nodes.push({
      parent: nearestNode(element.parentElement),
      origin: rest.origin,
      translate: pick('translate', rest.translate),
      rotate: pick('rotate', rest.rotate),
      scale: pick('scale', rest.scale),
      transform: pick('transform', rest.transform),
      moves: moving.length > 0,
      before: parentCtm,
      after: Affine.multiply(Affine.invert(rest.local), Affine.invert(parentCtm)),
      alpha: fading.flatMap(prop => trackOf(element, prop) ?? []),
    })
  }

  // The element whose animation drives a vector property of a part: the part itself or the ancestor it inherits from.
  const vectorSource = (element: Element, prop: VectorProp): Element | undefined => {
    for (let at: Element | null = element; at !== null && at !== root; at = at.parentElement) if (winners.get(at)?.has(prop) === true) return at
    return undefined
  }
  const isVector = (leaf: Element) => VECTOR_PROPS.some(prop => vectorSource(leaf, prop) !== undefined)
  const owner = (leaf: Element) => nearestNode(leaf)
  // A part moves inside a group when the element it moves with is the group's descendant, or it is drawn as a vector.
  const movesInside = new Map<Element, boolean>()
  for (const leaf of rects.keys()) {
    const index = owner(leaf)
    const mover = nodeElements[index]
    for (let at = leaf.parentElement; at !== null && at !== root; at = at.parentElement)
      if (isVector(leaf) || (mover !== undefined && mover !== at && at.contains(mover))) movesInside.set(at, true)
  }
  const isLayer = (element: Element): boolean => {
    if (!CONTAINERS.has(element.localName)) return false
    const rest = base.get(element)
    if (rest === undefined) return false
    if (rest.blend !== 'normal') return true
    if (movesInside.get(element) !== true) return false
    return rest.effects || (alphaPropsOf.get(element)?.length ?? 0) > 0
  }
  const layers = new Set(rendered.filter(isLayer))

  // Alpha nodes from a node upward, up to (not including) the enclosing layer or anything above it.
  const alphaChain = (start: number, enclosing: Element | undefined): number[] => {
    const out: number[] = []
    for (let index = start; index >= 0; index = nodes[index]?.parent ?? -1) {
      const element = nodeElements[index]
      if (element === undefined || (enclosing !== undefined && (element === enclosing || element.contains(enclosing)))) break
      if ((nodes[index]?.alpha.length ?? 0) > 0) out.push(index)
    }
    return out
  }

  /**
   * The part of the scene, before a node's motion, that its motion ever brings into the frame: the frame mapped back
   * through the motion at even times over its longest period, widened by the largest move between two samples.
   */
  const reached = new Map<number, Rect>()
  const reachable = (start: number): Rect => {
    const known = reached.get(start)
    if (known !== undefined) return known
    const chain: number[] = []
    for (let index = start; index >= 0; index = nodes[index]?.parent ?? -1) if (nodes[index]?.moves === true) chain.push(index)
    const tracksOf = (node: MotionNode | undefined): Track[] =>
      node === undefined
        ? []
        : [node.translate, node.rotate, node.scale, node.transform].filter(
            (value): value is Track => typeof value === 'object' && value !== null && !Array.isArray(value) && 'count' in value,
          )
    const longest = Math.max(1, ...chain.flatMap(index => tracksOf(nodes[index]).map(track => track.period)))
    let area: Rect | undefined
    let stride = 0
    let previous: Matrix | undefined
    for (let step = 0; step <= REACH_SAMPLES; step += 1) {
      const time = (step * longest) / REACH_SAMPLES
      let move: Matrix = IDENTITY
      // Root first, as the renderer composes them.
      for (const index of [...chain].reverse()) {
        const node = nodes[index]
        if (node === undefined) continue
        move = Affine.multiply(move, Affine.multiply(Affine.multiply(node.before, SceneMath.localAt(node, time)), node.after))
      }
      area = union(area, Affine.mapRect(Affine.invert(move), viewBox))
      if (previous !== undefined) stride = Math.max(stride, Math.hypot(move[4] - previous[4], move[5] - previous[5]))
      previous = move
    }
    const margin = stride + 0.01 * Math.max(viewBox[2], viewBox[3])
    const result: Rect = area === undefined ? viewBox : [area[0] - margin, area[1] - margin, area[2] + 2 * margin, area[3] + 2 * margin]
    reached.set(start, result)
    return result
  }

  // 4. Paint order: runs of parts that move together become sprites; vectors and layers cut the runs.
  const cells: PlannedCell[] = []
  const structural = /:(?:first|last|nth|only)-|[+~>]/u.test(
    [...shadow.querySelectorAll('style')].map(style => (style.textContent ?? '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, '')).join(''),
  )
  const serializer = new XMLSerializer()
  const cellMarkup = (
    includes: ReadonlySet<Element>,
    overrides: ReadonlyMap<Element, readonly string[]>,
    replace?: { readonly element: Element; readonly rect: Rect },
  ): string => {
    const ancestors = new Set<Element>()
    for (const element of [...includes, ...(replace === undefined ? [] : [replace.element])])
      for (let at = replace?.element === element ? element : element.parentElement; at !== null && at !== root; at = at.parentElement) ancestors.add(at)
    const emit = (parent: Element): string => {
      let markup = ''
      for (const child of parent.children) {
        if (SKIPPED.has(child.localName) || isResource(child)) continue
        if (includes.has(child)) {
          const clone = child.cloneNode(true)
          if (!(clone instanceof Element)) continue
          strip(clone)
          addStyle(clone, overrides.get(child) ?? [])
          markup += serializer.serializeToString(clone)
        } else if (ancestors.has(child)) {
          const shell = child.cloneNode(false)
          if (!(shell instanceof Element)) continue
          strip(shell)
          addStyle(shell, overrides.get(child) ?? [])
          let inner: string
          if (replace?.element === child) {
            const [x, y, w, h] = replace.rect
            inner = `<rect x="${x}" y="${y}" width="${w}" height="${h}" style="fill:#fff!important;fill-opacity:1!important;stroke:none!important;opacity:1!important;visibility:visible!important"/>`
          } else inner = emit(child)
          // The shell serialises empty (`<g …/>`): its content goes inside it.
          const open = serializer.serializeToString(shell).replace(/\s*\/>$/u, '>')
          markup += `${open}${inner}</${shell.localName}>`
        } else if (structural) markup += `<${child.localName}${child.hasAttribute('class') ? ` class="${child.getAttribute('class') ?? ''}"` : ''}/>`
      }
      return markup
    }
    return emit(root)
  }
  // Inline overrides of every cell: a layer's own effects are composited by the renderer, an animated alpha is drawn
  // by the track, so the picture holds neither.
  const overrides = new Map<Element, readonly string[]>()
  for (const element of layers) overrides.set(element, ['opacity:1', 'clip-path:none', 'mask:none', 'mix-blend-mode:normal', 'filter:none'])
  for (const [element, props] of alphaPropsOf) overrides.set(element, [...(overrides.get(element) ?? []), ...props.map(prop => `${ALPHA_CSS[prop]}:1`)])

  interface Run {
    readonly node: number
    readonly leaves: Element[]
    rect: Rect | undefined
  }
  /** The items of a layer (or of the scene): one shared run state, so a plain group's parts continue the run. */
  const build = (parent: Element, enclosing: Element | undefined): SceneItem[] => {
    const items: SceneItem[] = []
    let run: Run | undefined
    const flush = (): void => {
      if (run?.rect === undefined) {
        run = undefined
        return
      }
      // A picture keeps only what can ever be on screen: a still one the scene's own frame, a moving one what its motion
      // brings into it.
      const rect = intersect(run.rect, run.node < 0 ? grow(viewBox, 0.01) : reachable(run.node))
      if (rect !== undefined) {
        items.push({ kind: 'sprite', node: run.node, alpha: alphaChain(run.node, enclosing), sprite: cells.length, rect } satisfies SpriteItem)
        cells.push({ rect, markup: cellMarkup(new Set(run.leaves), overrides) })
      }
      run = undefined
    }
    const visit = (container: Element): void => {
      for (const child of container.children) {
        if (SKIPPED.has(child.localName) || isResource(child)) continue
        if (layers.has(child)) {
          flush()
          items.push(layerItem(child, enclosing))
        } else if (CONTAINERS.has(child.localName)) visit(child)
        else {
          const rect = rects.get(child)
          if (rect === undefined) continue
          if (isVector(child)) {
            flush()
            items.push(vectorItem(child, enclosing))
            continue
          }
          const node = owner(child)
          if (run !== undefined && run.node !== node) flush()
          run ??= { node, leaves: [], rect: undefined }
          run.leaves.push(child)
          run.rect = union(run.rect, rect)
        }
      }
    }
    visit(parent)
    flush()
    return items
  }

  const layerItem = (element: Element, enclosing: Element | undefined): LayerItem => {
    const rest = base.get(element)
    const node = nearestNode(element)
    const ownAlpha = alphaPropsOf.get(element) ?? []
    const style = getComputedStyle(element)
    let matte: LayerItem['matte'] = null
    if (style.clipPath !== 'none' || style.maskImage !== 'none') {
      const ctm = rest?.ctm ?? IDENTITY
      const moving = node >= 0
      const area = moving ? (intersect(reachable(node), grow(viewBox, 0.5)) ?? viewBox) : viewBox
      const local = Affine.mapRect(Affine.invert(ctm), grow(area, 0.05))
      const matteOverrides = new Map(overrides)
      // The matte keeps the group's clip and mask, and nothing else of the group.
      matteOverrides.set(element, ['opacity:1', 'mix-blend-mode:normal', 'filter:none'])
      for (let at = element.parentElement; at !== null && at !== root; at = at.parentElement)
        matteOverrides.set(at, ['opacity:1', 'clip-path:none', 'mask:none', 'mix-blend-mode:normal', 'filter:none'])
      matte = { sprite: cells.length, rect: area }
      cells.push({ rect: area, markup: cellMarkup(new Set(), matteOverrides, { element, rect: local }) })
    }
    const items = build(element, element)
    return {
      kind: 'layer',
      node,
      alpha: alphaChain(node, enclosing),
      opacity: ownAlpha.includes('opacity') ? 1 : (rest?.opacity ?? 1),
      blend: blendOf(rest?.blend),
      matte,
      items,
    }
  }

  const vectorItem = (element: Element, enclosing: Element | undefined): VectorItem => {
    const own = restStyle.get(element)
    if (own === undefined) throw new SceneCompileError('a moving stroke without a style')
    let style: RestStyle = own
    /** The shape's own opacity, under a <use> (the <use>'s is in `own`). */
    let shapeOpacity = 1
    let shape: Element = element
    let matrix = base.get(element)?.ctm ?? IDENTITY
    if (element.localName === 'use') {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? ''
      const target = href.startsWith('#') ? shadow.getElementById(href.slice(1)) : null
      if (target === null) throw new SceneCompileError(`a <use> of a missing ${href}`)
      shape = target
      const x = Number.parseFloat(element.getAttribute('x') ?? '0') || 0
      const y = Number.parseFloat(element.getAttribute('y') ?? '0') || 0
      matrix = Affine.multiply(Affine.multiply(matrix, Affine.translate(x, y)), Affine.parseTransform(getComputedStyle(target).transform))
      // A <use> draws a copy of its target that inherits from the <use> and matches the scene's rules itself
      // (`path{fill:none}`): read the paint from such a copy, put where the <use> is.
      const proxy = element.ownerDocument.createElementNS(SVG_NS, 'g')
      for (const attribute of element.attributes)
        if (!['href', 'xlink:href', 'x', 'y', 'id', 'transform'].includes(attribute.name)) proxy.setAttribute(attribute.name, attribute.value)
      const copy = target.cloneNode(true)
      if (copy instanceof Element) {
        strip(copy)
        proxy.append(copy)
        element.before(proxy)
        const computed = getComputedStyle(copy)
        style = { ...readPaint(computed), opacity: own.opacity }
        shapeOpacity = Number.parseFloat(computed.opacity) || 0
        proxy.remove()
      }
    }
    if (!(shape instanceof SVGPathElement)) throw new SceneCompileError(`a moving stroke on a <${shape.localName}>`)
    const d = shape.getAttribute('d') ?? ''
    const node = owner(element)
    const chain = alphaChain(node, enclosing)
    // An alpha animated on the part or above it is drawn by its track: the paint keeps 1 for it.
    const animated = new Set(chain.flatMap(index => alphaPropsOf.get(nodeElements[index] ?? root) ?? []))
    const strokeOpacity = animated.has('strokeOpacity') ? 1 : Number.parseFloat(style.strokeOpacity)
    const fillOpacity = animated.has('fillOpacity') ? 1 : Number.parseFloat(style.fillOpacity)
    const opacity = (animated.has('opacity') ? 1 : Number.parseFloat(style.opacity)) * shapeOpacity
    const pathLength = Number.parseFloat(shape.getAttribute('pathLength') ?? '')
    const dashScale = pathLength > 0 ? shape.getTotalLength() / pathLength : 1
    const dashes =
      style.strokeDasharray === 'none' ? null : (style.strokeDasharray.match(/-?[\d.]+(?:e[-+]?\d+)?/giu) ?? []).map(value => Number(value) * dashScale)
    const widthSource = vectorSource(element, 'strokeWidth')
    const offsetSource = vectorSource(element, 'strokeDashoffset')
    const capValue = style.strokeLinecap
    const cap: CanvasLineCap = capValue === 'round' || capValue === 'square' ? capValue : 'butt'
    const joinValue = style.strokeLinejoin
    const join: CanvasLineJoin = joinValue === 'round' || joinValue === 'bevel' ? joinValue : 'miter'
    const dots = DOTS.test(d) && cap !== 'butt' ? dotsOf(d) : undefined
    const item: VectorItem = {
      kind: 'vector',
      node,
      alpha: chain,
      matrix,
      ...(dots === undefined ? { path: d } : { dots }),
      stroke: paint(style.stroke, strokeOpacity * opacity),
      fill: dots === undefined ? paint(style.fill, fillOpacity * opacity) : null,
      width: (widthSource === undefined ? undefined : trackOf(widthSource, 'strokeWidth')) ?? Number.parseFloat(style.strokeWidth),
      dash: dashes === null || dashes.length === 0 ? null : dashes,
      dashOffset: (offsetSource === undefined ? undefined : trackOf(offsetSource, 'strokeDashoffset')) ?? Number.parseFloat(style.strokeDashoffset),
      dashScale,
      cap,
      join,
      miter: Number.parseFloat(style.strokeMiterlimit) || 4,
      batch: -1,
    }
    return item
  }

  const items = build(root, undefined)
  const batches = assignBatches(items, nodes)
  const resourcesMarkup = resources.map(element => serializer.serializeToString(element.cloneNode(true))).join('')
  // Shapes a <use> draws from outside <defs> are copied there too, with their ids.
  const used = new Set<Element>()
  for (const use of root.querySelectorAll('use')) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? ''
    const target = href.startsWith('#') ? shadow.getElementById(href.slice(1)) : null
    if (target !== null && !resources.some(resource => resource.contains(target))) used.add(target)
  }
  const usedMarkup = [...used].map(element => serializer.serializeToString(element.cloneNode(true))).join('')
  const sceneStyle = [...shadow.querySelectorAll('style')].map(style => style.textContent ?? '').join('\n')
  const rootAttributes = [...root.attributes]
    .filter(
      attribute =>
        !['xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'x', 'y', 'style'].includes(attribute.name) && !attribute.name.startsWith('xmlns'),
    )
    .map(attribute => ` ${attribute.name}="${attribute.value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')}"`)
    .join('')
  return {
    model: { viewBox, nodes, items, sprites: cells.length, batches, still: tracks.length === 0 },
    cells,
    style: `${sceneStyle}\n*{animation:none!important;transition:none!important}`,
    defs: `<defs>${resourcesMarkup}${usedMarkup}</defs>`,
    rootAttributes,
  }
}

/** A vector item's widest stroke, over its track. */
function widest(item: VectorItem): number {
  if (typeof item.width === 'number') return item.width
  let max = 0
  for (const value of item.width.values) max = Math.max(max, value)
  return max
}

/**
 * Groups consecutive dot items that only change size (no motion, alpha or dash) into retained batches, when no two of
 * their dots can ever touch; returns the smallest gap of each batch. Items are updated in place through a new array.
 */
function assignBatches(items: SceneItem[], nodes: readonly MotionNode[]): number[] {
  const gaps: number[] = []
  const still = (node: number): boolean => {
    for (let index = node; index >= 0; index = nodes[index]?.parent ?? -1)
      if ((nodes[index]?.moves ?? false) || (nodes[index]?.alpha.length ?? 0) > 0) return false
    return true
  }
  const eligible = (item: SceneItem): item is VectorItem =>
    item.kind === 'vector' && item.dots !== undefined && item.dash === null && still(item.node) && item.alpha.length === 0
  const close = (start: number, end: number): void => {
    if (end <= start) return
    const group = items.slice(start, end).filter(eligible)
    const gap = minimumGap(group)
    if (gap <= 0) return
    const id = gaps.length
    gaps.push(gap)
    for (let index = start; index < end; index += 1) {
      const item = items[index]
      if (item !== undefined && eligible(item)) items[index] = { ...item, batch: id }
    }
  }
  let start = -1
  for (let index = 0; index <= items.length; index += 1) {
    const item = items[index]
    if (item !== undefined && item.kind === 'layer') {
      const inner = [...item.items]
      const innerGaps = assignBatches(inner, nodes)
      const offset = gaps.length
      gaps.push(...innerGaps)
      items[index] = { ...item, items: inner.map(child => (child.kind === 'vector' && child.batch >= 0 ? { ...child, batch: child.batch + offset } : child)) }
    }
    if (item !== undefined && eligible(item)) {
      if (start < 0) start = index
      continue
    }
    if (start >= 0) close(start, index)
    start = -1
  }
  return gaps
}

/** The smallest distance between the edges of two dots of different items at their largest, in scene units. */
function minimumGap(group: readonly VectorItem[]): number {
  const cell = 32
  const grid = new Map<string, { item: number; x: number; y: number; r: number }[]>()
  let gap = Number.POSITIVE_INFINITY
  group.forEach((item, which) => {
    const scale = Math.sqrt(Math.abs(item.matrix[0] * item.matrix[3] - item.matrix[1] * item.matrix[2]))
    const radius = (widest(item) * scale) / 2
    const dots = item.dots ?? new Float32Array()
    for (let index = 0; index + 1 < dots.length; index += 2) {
      const [x, y] = Affine.apply(item.matrix, dots[index] ?? 0, dots[index + 1] ?? 0)
      const cx = Math.floor(x / cell)
      const cy = Math.floor(y / cell)
      for (let dx = -1; dx <= 1; dx += 1)
        for (let dy = -1; dy <= 1; dy += 1)
          for (const other of grid.get(`${cx + dx}:${cy + dy}`) ?? [])
            if (other.item !== which) gap = Math.min(gap, Math.hypot(other.x - x, other.y - y) - other.r - radius)
      const key = `${cx}:${cy}`
      const list = grid.get(key) ?? []
      list.push({ item: which, x, y, r: radius })
      grid.set(key, list)
    }
  })
  return gap
}

const ATLAS = 4096
const GAP = 2

/**
 * Rasterises a plan's sprites at `scale` device pixels per scene unit: cells are packed on atlas pages, each page is one
 * SVG image the browser decodes once, and each sprite is cut out as an `ImageBitmap`.
 */
export async function rasterizePlan(plan: ScenePlan, scale: number): Promise<ImageBitmap[]> {
  const yieldNow = breather()
  interface Placed {
    readonly index: number
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  const pages: Placed[][] = [[]]
  let x = 0
  let y = 0
  let shelf = 0
  plan.cells.forEach((cell, index) => {
    const fit = Math.min(scale, (ATLAS - 2 * GAP) / Math.max(cell.rect[2], cell.rect[3]))
    const width = Math.max(1, Math.ceil(cell.rect[2] * fit))
    const height = Math.max(1, Math.ceil(cell.rect[3] * fit))
    if (x + width + GAP > ATLAS) {
      x = 0
      y += shelf + GAP
      shelf = 0
    }
    if (y + height + GAP > ATLAS) {
      pages.push([])
      x = 0
      y = 0
      shelf = 0
    }
    pages.at(-1)?.push({ index, x, y, width, height })
    x += width + GAP
    shelf = Math.max(shelf, height)
  })
  const bitmaps: ImageBitmap[] = new Array(plan.cells.length)
  for (const page of pages) {
    if (page.length === 0) continue
    const width = Math.max(...page.map(cell => cell.x + cell.width))
    const height = Math.max(...page.map(cell => cell.y + cell.height))
    const body = page
      .map(placed => {
        const cell = plan.cells[placed.index]
        if (cell === undefined) return ''
        const [rx, ry, rw, rh] = cell.rect
        return `<svg x="${placed.x}" y="${placed.y}" width="${placed.width}" height="${placed.height}" viewBox="${rx} ${ry} ${rw} ${rh}" preserveAspectRatio="none" overflow="hidden">${cell.markup}</svg>`
      })
      .join('')
    const markup = `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${plan.rootAttributes}><style><![CDATA[${plan.style.replace(/\]\]>/gu, '')}]]></style>${plan.defs}${body}</svg>`
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      for (const placed of page) bitmaps[placed.index] = await createImageBitmap(image, placed.x, placed.y, placed.width, placed.height)
    } finally {
      URL.revokeObjectURL(url)
    }
    await yieldNow()
  }
  return bitmaps
}
