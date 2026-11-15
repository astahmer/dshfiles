import { SCENE_FRAME_RATE } from '@dshfiles/plugin-ui/theme/appearance'
import { BACKDROP_HOST, BACKDROP_PAUSED_ATTRIBUTE, SCENE_STAGE_ATTRIBUTE } from '@dshfiles/plugin-ui/theme/definition'

/**
 * Moves the theme backdrop at a bounded frame rate, and only in the tab the user is in.
 *
 * A scene used to be an animated SVG `background-image`. Chrome cannot composite or slow the animations inside an image,
 * so it re-styled, re-painted and re-rasterised the whole viewport-sized picture on every display frame, in every open
 * DSH tab: on a 120 Hz screen Snow Pines kept 2.6 CPU cores busy across the renderers, the raster workers and the GPU
 * process with two windows open.
 *
 * Here each scene is an inline SVG in the shadow root of a stage element, the first child of the backdrop host (the
 * shadow root keeps the scene's `<style>` and ids out of the page). Its CSS animations stay paused; a scene clock moves
 * them forward together `frameRate` times a second, so the browser repaints the scene only then. The clock runs only
 * while the tab has focus and is shown: every other tab holds the frame it is on and paints nothing, so the cost no
 * longer grows with the number of open tabs, and the scene resumes where it stopped. The same rule pauses a theme's
 * animated layers through `BACKDROP_PAUSED_ATTRIBUTE` on `<body>`. The theme CSS (plugin-ui `backdropCss`) shows the
 * stage of the active scheme's scene and hides the others.
 */

/** The part of a Web Animation the clock drives. */
export interface SteppedAnimation {
  currentTime: CSSNumberish | null
  pause(): void
}

/** Where an animation stood, and the scene clock's time, when the clock first saw it. */
interface Origin {
  readonly time: number
  readonly at: number
}

/**
 * Puts each animation where it would be had it run freely for the scene time elapsed since the clock first saw it; it
 * stays paused in between. An animation the clock has not seen (a scene just mounted, or one a style change restarted)
 * is paused where it stands. An animation already at its place is left alone, so a held scene costs nothing. Returns
 * how many animations it moved.
 */
function stepAnimations(animations: Iterable<SteppedAnimation>, origins: WeakMap<SteppedAnimation, Origin>, clock: number): number {
  let moved = 0
  for (const animation of animations) {
    let origin = origins.get(animation)
    if (origin === undefined) {
      animation.pause()
      const current = animation.currentTime
      origin = { time: typeof current === 'number' ? current : 0, at: clock }
      origins.set(animation, origin)
    }
    const next = origin.time + (clock - origin.at)
    if (animation.currentTime === next) continue
    animation.currentTime = next
    moved += 1
  }
  return moved
}

/** Milliseconds until the next tick: one frame while the backdrop moves, else a slow check of the mount. */
function tickInterval(frameRate: number, moving: boolean): number {
  return moving && frameRate > 0 ? 1000 / frameRate : 1000
}

/** Whether the backdrop moves in this tab: a frame rate above 0, and the tab shown and focused. */
function isMoving(frameRate: number, visible: boolean, focused: boolean): boolean {
  return frameRate > 0 && visible && focused
}

/** A scene to paint: its id and SVG. */
export interface StageScene {
  readonly id: string
  readonly svg: string
}

interface Stage {
  readonly element: HTMLElement
  readonly svg: string
  readonly picture: SVGSVGElement
  readonly rest: HTMLStyleElement
  readonly root: ShadowRoot
}

/** Isolates the scene from the page's inherited fonts and colours, as an image was. */
const HOST_RESET = ':host { all: initial; }'
/** The resting picture: every animation off, as the scene's own reduced-motion rules do. */
const RESTING = '* { animation: none !important; }'

/** The stages of the active theme's scenes, mounted in the backdrop host and stepped on one timer. */
export class SceneStage {
  readonly #doc: Document
  readonly #stages = new Map<string, Stage>()
  readonly #origins = new WeakMap<SteppedAnimation, Origin>()
  #frameRate: number = SCENE_FRAME_RATE.default
  #timer: ReturnType<typeof setTimeout> | undefined
  #frame = ''
  /** Scene time: it advances only while the backdrop moves in this tab. */
  #clock = 0
  #last: number | undefined
  readonly #wake = (): void => this.#schedule(0)

  constructor(doc: Document) {
    this.#doc = doc
    const view = doc.defaultView
    view?.addEventListener('focus', this.#wake)
    view?.addEventListener('blur', this.#wake)
    doc.addEventListener('visibilitychange', this.#wake)
    this.#schedule(0)
  }

  /** Paints exactly these scenes at this frame rate; a scene already painted with the same SVG keeps its motion. */
  update(scenes: readonly StageScene[], frameRate: number): void {
    const wanted = new Map(scenes.map(scene => [scene.id, scene.svg]))
    for (const [id, stage] of this.#stages)
      if (wanted.get(id) !== stage.svg) {
        stage.element.remove()
        this.#stages.delete(id)
      }
    for (const [id, svg] of wanted) {
      if (this.#stages.has(id)) continue
      const stage = this.#create(id, svg)
      if (stage !== undefined) this.#stages.set(id, stage)
    }
    this.#frameRate = frameRate
    for (const stage of this.#stages.values()) stage.rest.textContent = frameRate > 0 ? '' : RESTING
    this.#frame = ''
    this.#schedule(0)
  }

  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    const view = this.#doc.defaultView
    view?.removeEventListener('focus', this.#wake)
    view?.removeEventListener('blur', this.#wake)
    this.#doc.removeEventListener('visibilitychange', this.#wake)
    this.#doc.body.removeAttribute(BACKDROP_PAUSED_ATTRIBUTE)
    for (const stage of this.#stages.values()) stage.element.remove()
    this.#stages.clear()
  }

  #create(id: string, svg: string): Stage | undefined {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const picture = this.#doc.importNode(parsed.documentElement, true)
    if (!(picture instanceof SVGSVGElement) || parsed.getElementsByTagName('parsererror').length > 0) {
      console.warn(`dshfiles-ui-styles: the backdrop scene "${id}" is not a valid SVG and is not painted; choose another theme or reload`)
      return undefined
    }
    const element = this.#doc.createElement('div')
    element.setAttribute(SCENE_STAGE_ATTRIBUTE, id)
    element.setAttribute('aria-hidden', 'true')
    const root = element.attachShadow({ mode: 'open' })
    const reset = this.#doc.createElement('style')
    reset.textContent = HOST_RESET
    const rest = this.#doc.createElement('style')
    // `background-size: cover` centred, as the scene was painted before.
    picture.setAttribute('preserveAspectRatio', 'xMidYMid slice')
    picture.style.position = 'absolute'
    root.append(reset, rest, picture)
    return { element, svg, picture, rest, root }
  }

  #schedule(delay: number): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(this.#tick, delay)
  }

  readonly #tick = (): void => {
    this.#timer = undefined
    const moving = isMoving(this.#frameRate, !this.#doc.hidden, this.#doc.hasFocus())
    // A theme's animated layers hold still with the scene.
    this.#doc.body.toggleAttribute(BACKDROP_PAUSED_ATTRIBUTE, !moving)
    const now = performance.now()
    if (moving && this.#last !== undefined) this.#clock += now - this.#last
    this.#last = moving ? now : undefined
    if (this.#stages.size > 0 && !this.#doc.hidden) {
      const host = this.#doc.querySelector<HTMLElement>(BACKDROP_HOST)
      if (host !== null) {
        // Read the layout before any animation moves, while it is still clean from the last frame.
        this.#align(host)
        for (const stage of this.#stages.values()) {
          if (stage.element.parentElement !== host) host.prepend(stage.element)
          // Also while held: an animation a style change just restarted is paused at once.
          if (this.#frameRate > 0) stepAnimations(stage.root.getAnimations(), this.#origins, this.#clock)
        }
      }
    }
    // Without a scene, or in a hidden tab, nothing needs a timer: focus and visibility changes wake the stage.
    if (this.#stages.size > 0 && !this.#doc.hidden) this.#schedule(tickInterval(this.#frameRate, moving))
  }

  /** Lays each picture over the whole viewport, so it lines up with the blurred still in the reading veil. */
  #align(host: HTMLElement): void {
    const view = this.#doc.defaultView
    if (view === null) return
    const box = host.getBoundingClientRect()
    const frame = `${-box.left}:${-box.top}:${view.innerWidth}:${view.innerHeight}`
    if (frame === this.#frame) return
    this.#frame = frame
    for (const { picture } of this.#stages.values()) {
      picture.style.left = `${-box.left}px`
      picture.style.top = `${-box.top}px`
      picture.style.width = `${view.innerWidth}px`
      picture.style.height = `${view.innerHeight}px`
    }
  }
}

/** The pure parts of the stage, for tests. */
export class SceneClock {
  static readonly step = stepAnimations
  static readonly interval = tickInterval
  static readonly moving = isMoving
}
