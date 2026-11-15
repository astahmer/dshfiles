import { SCENE_FRAME_RATE } from '@dshfiles/plugin-ui/theme/appearance'
import { BACKDROP_HOST, BACKDROP_PAUSED_ATTRIBUTE, SCENE_STAGE_ATTRIBUTE } from '@dshfiles/plugin-ui/theme/definition'
import { SceneCatalog } from '@dshfiles/plugin-ui/theme/scenes'
import { planScene, rasterizePlan, SceneCompileError } from './scene-canvas/compile.js'
import type { Rect, WorkerMessage } from './scene-canvas/model.js'
import { SceneView } from './scene-canvas/view.js'
import SceneWorker from './scene-canvas/worker.ts?worker&inline'

/**
 * Paints the theme backdrop scenes on a canvas, drawn by a worker.
 *
 * A scene is an animated SVG. Painted as an image (or inline), Chrome re-styles, re-paints and re-rasterises the whole
 * viewport-sized picture on every display frame, on the CPU: Snow Pines alone kept 1.5 cores busy. Here the SVG is read
 * once (`scene-canvas/compile.ts`): each moving part becomes a picture rasterised once, each CSS animation a track of
 * sampled values. A worker then draws those pictures on an `OffscreenCanvas` where the tracks say, at the display's
 * frame rate capped by `sceneFrameRate`; a frame is a few image draws, off the page's main thread.
 *
 * The scene moves only in the tab the user is in (focused and shown): every other tab holds its frame and paints
 * nothing, and `BACKDROP_PAUSED_ATTRIBUTE` on `<body>` pauses a theme's animated layers with it. Until the scene is
 * compiled, with `sceneFrameRate` 0, under reduced motion, or where the browser has no `OffscreenCanvas`, the stage
 * shows the scene's resting picture as a still image. The theme CSS (plugin-ui `backdropCss`) shows the stage of the
 * active scheme's scene and hides the others.
 */

/** A scene to paint: its id and SVG. */
export interface StageScene {
  readonly id: string
  readonly svg: string
}

interface Stage {
  readonly id: string
  readonly svg: string
  readonly element: HTMLElement
  /** The resting picture as a CSS image, shown whenever the canvas does not draw. */
  readonly resting: string
  /** Set once the scene is compiled and its canvas handed to the worker. */
  live?: { readonly worker: Worker; readonly canvas: HTMLCanvasElement; readonly viewBox: Rect; scale: number } | undefined
  compiling: boolean
  /** The worker has the pictures: the canvas shows the whole scene. */
  drawn: boolean
  failed: boolean
  frame: string
}

/** Rasterise again when the device scale drifts this far from the pictures', so they never look soft. */
const RESCALE = 1.15

/** The stages of the active theme's scenes, mounted in the backdrop host. */
export class SceneStage {
  readonly #doc: Document
  readonly #stages = new Map<string, Stage>()
  #frameRate: number = SCENE_FRAME_RATE.default
  #moving = false
  #watch: ReturnType<typeof setInterval> | undefined
  #resize: ResizeObserver | undefined
  #observed: Element | null = null
  readonly #motion: MediaQueryList | undefined
  readonly #wake = (): void => this.#refresh()

  constructor(doc: Document) {
    this.#doc = doc
    const view = doc.defaultView
    this.#motion = view?.matchMedia('(prefers-reduced-motion: reduce)')
    view?.addEventListener('focus', this.#wake)
    view?.addEventListener('blur', this.#wake)
    view?.addEventListener('resize', this.#wake)
    doc.addEventListener('visibilitychange', this.#wake)
    this.#motion?.addEventListener('change', this.#wake)
    if (typeof ResizeObserver === 'function') this.#resize = new ResizeObserver(() => this.#refresh())
    this.#refresh()
  }

  /** Paints exactly these scenes at this frame rate; a scene already painted with the same SVG keeps its motion. */
  update(scenes: readonly StageScene[], frameRate: number): void {
    const wanted = new Map(scenes.map(scene => [scene.id, scene.svg]))
    for (const [id, stage] of this.#stages)
      if (wanted.get(id) !== stage.svg) {
        this.#drop(stage)
        this.#stages.delete(id)
      }
    for (const [id, svg] of wanted) if (!this.#stages.has(id)) this.#stages.set(id, this.#create(id, svg))
    this.#frameRate = frameRate
    this.#refresh()
  }

  dispose(): void {
    const view = this.#doc.defaultView
    view?.removeEventListener('focus', this.#wake)
    view?.removeEventListener('blur', this.#wake)
    view?.removeEventListener('resize', this.#wake)
    this.#doc.removeEventListener('visibilitychange', this.#wake)
    this.#motion?.removeEventListener('change', this.#wake)
    this.#resize?.disconnect()
    if (this.#watch !== undefined) clearInterval(this.#watch)
    this.#watch = undefined
    this.#doc.body.removeAttribute(BACKDROP_PAUSED_ATTRIBUTE)
    for (const stage of this.#stages.values()) this.#drop(stage)
    this.#stages.clear()
  }

  #create(id: string, svg: string): Stage {
    const element = this.#doc.createElement('div')
    element.setAttribute(SCENE_STAGE_ATTRIBUTE, id)
    element.setAttribute('aria-hidden', 'true')
    // The resting picture, fixed to the viewport like the scene and its stills: shown until the canvas draws.
    const resting = SceneCatalog.image(SceneCatalog.resting(svg))
    element.style.backgroundImage = resting
    element.style.backgroundAttachment = 'fixed'
    element.style.backgroundSize = 'cover'
    element.style.backgroundPosition = 'center'
    element.style.backgroundRepeat = 'no-repeat'
    return { id, svg, element, resting, compiling: false, drawn: false, failed: false, frame: '' }
  }

  #drop(stage: Stage): void {
    stage.live?.worker.terminate()
    stage.element.remove()
  }

  /** Mounts the stages, follows the host's size, and starts or holds the scenes. */
  #refresh(): void {
    const reduced = this.#motion?.matches ?? false
    const moving = SceneView.moving(this.#frameRate, !this.#doc.hidden, this.#doc.hasFocus(), reduced)
    this.#moving = moving
    // A theme's animated layers hold still with the scene.
    this.#doc.body.toggleAttribute(BACKDROP_PAUSED_ATTRIBUTE, !moving)
    // The host can be replaced by the workbench: a slow check keeps the stages in it while there are any.
    if (this.#stages.size > 0 && this.#watch === undefined) this.#watch = setInterval(() => this.#mount(), 1000)
    if (this.#stages.size === 0 && this.#watch !== undefined) {
      clearInterval(this.#watch)
      this.#watch = undefined
    }
    const host = this.#mount()
    const animate = this.#frameRate > 0 && !reduced
    for (const stage of this.#stages.values()) {
      if (animate && stage.live === undefined && !stage.compiling && !stage.failed) void this.#compile(stage)
      // The canvas draws the whole scene while it animates: the resting image under it would only be painted for nothing.
      const drawn = stage.live !== undefined && stage.drawn && animate
      stage.element.style.backgroundImage = drawn ? 'none' : stage.resting
      if (stage.live !== undefined) {
        stage.live.canvas.style.display = drawn ? 'block' : 'none'
        if (host !== null) this.#view(stage, host)
        this.#post(stage, { type: 'run', running: moving && animate, frameRate: this.#frameRate })
      }
    }
  }

  /** Puts every stage first in the backdrop host, and watches the host's size. */
  #mount(): HTMLElement | null {
    const host = this.#doc.querySelector<HTMLElement>(BACKDROP_HOST)
    if (host === null) return null
    for (const stage of this.#stages.values()) if (stage.element.parentElement !== host) host.prepend(stage.element)
    if (this.#observed !== host) {
      this.#resize?.disconnect()
      this.#resize?.observe(host)
      this.#observed = host
      this.#refreshSoon()
    }
    return host
  }

  #soon: ReturnType<typeof setTimeout> | undefined
  #refreshSoon(): void {
    if (this.#soon !== undefined) return
    this.#soon = setTimeout(() => {
      this.#soon = undefined
      this.#refresh()
    }, 0)
  }

  /** Sizes the canvas to the host and tells the worker where the scene lies; rasterises again when the scale drifts. */
  #view(stage: Stage, host: HTMLElement): void {
    const live = stage.live
    const view = this.#doc.defaultView
    if (live === undefined || view === null) return
    const dpr = view.devicePixelRatio || 1
    const box = host.getBoundingClientRect()
    const viewport = { width: view.innerWidth, height: view.innerHeight }
    const width = Math.max(1, Math.round(box.width * dpr))
    const height = Math.max(1, Math.round(box.height * dpr))
    const frame = `${width}:${height}:${box.left}:${box.top}:${viewport.width}:${viewport.height}:${dpr}`
    if (frame === stage.frame) return
    stage.frame = frame
    this.#post(stage, { type: 'view', width, height, matrix: SceneView.view(live.viewBox, viewport, box, dpr) })
    const scale = SceneView.scale(live.viewBox, viewport, dpr)
    if (scale > live.scale * RESCALE || scale < live.scale / RESCALE) void this.#raster(stage, scale)
  }

  #post(stage: Stage, message: WorkerMessage, transfer: Transferable[] = []): void {
    stage.live?.worker.postMessage(message, transfer)
  }

  #plans = new WeakMap<Stage, Awaited<ReturnType<typeof planScene>>>()

  async #compile(stage: Stage): Promise<void> {
    const view = this.#doc.defaultView
    const canvas = this.#doc.createElement('canvas')
    if (view === null || typeof canvas.transferControlToOffscreen !== 'function' || typeof Worker !== 'function') {
      stage.failed = true
      return
    }
    stage.compiling = true
    try {
      const plan = await planScene(stage.svg, this.#doc)
      if (this.#stages.get(stage.id) !== stage) return
      this.#plans.set(stage, plan)
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
      const offscreen = canvas.transferControlToOffscreen()
      const worker = new SceneWorker({ name: `dshfiles-scene-${stage.id}` })
      stage.live = { worker, canvas, viewBox: plan.model.viewBox, scale: 0 }
      this.#post(stage, { type: 'canvas', canvas: offscreen }, [offscreen])
      stage.element.append(canvas)
      const scale = SceneView.scale(plan.model.viewBox, { width: view.innerWidth, height: view.innerHeight }, view.devicePixelRatio || 1)
      await this.#raster(stage, scale)
      stage.drawn = true
      stage.frame = ''
      this.#refresh()
    } catch (error) {
      stage.failed = true
      stage.live?.worker.terminate()
      stage.live = undefined
      canvas.remove()
      const reason = error instanceof SceneCompileError ? error.message : String(error)
      console.warn(
        `dshfiles-ui-styles: the backdrop scene "${stage.id}" shows a still picture: it could not be animated on the canvas (${reason}). Choose another theme for motion.`,
      )
    } finally {
      stage.compiling = false
    }
  }

  #rasterizing = new WeakSet<Stage>()

  async #raster(stage: Stage, scale: number): Promise<void> {
    const plan = this.#plans.get(stage)
    const live = stage.live
    if (plan === undefined || live === undefined || this.#rasterizing.has(stage)) return
    this.#rasterizing.add(stage)
    try {
      live.scale = scale
      const bitmaps = await rasterizePlan(plan, scale)
      if (this.#stages.get(stage.id) !== stage) {
        for (const bitmap of bitmaps) bitmap.close()
        return
      }
      this.#post(stage, { type: 'scene', model: plan.model, bitmaps }, bitmaps)
    } finally {
      this.#rasterizing.delete(stage)
    }
  }

  /** Whether the scenes move in this tab right now. */
  get moving(): boolean {
    return this.#moving
  }
}
