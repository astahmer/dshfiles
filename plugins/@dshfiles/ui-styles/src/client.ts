import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { installSheetDrag } from '@dshfiles/plugin-ui/hooks/sheet-drag'
import { AppearanceModel, type AppearanceSettings } from '@dshfiles/plugin-ui/theme/appearance'
import type { Rgb } from '@dshfiles/plugin-ui/theme/readability'
import { SceneCatalog } from '@dshfiles/plugin-ui/theme/scenes'
import { columnOfSample, GPU_ATTRIBUTE, SCENE_SAMPLE, type SceneSource } from '@dshfiles/plugin-ui/theme/definition'
import { PALETTE_NAMES_ATTRIBUTE } from '@dshfiles/plugin-ui/theme/identity'
import { themeApi } from './api.js'
import './client.css'
import { RuntimeTheme, RUNTIME_STYLE_ID } from './runtime-theme.js'
import { SceneStage } from './scene-stage.js'
import { UI_STYLES_SETTINGS_NAMESPACE } from './settings-namespace.js'

/**
 * A coarse sample of a scene's resting picture, drawn once at `SCENE_SAMPLE` size: the whole picture (where chrome
 * outside the column sits) and its middle 60% (under the conversation column). The theme turns them into the veil its
 * text needs (ReadabilityModel). Undefined when the browser cannot decode the SVG; the theme then uses a safe veil.
 * `plugins/@dshfiles/ui-styles/scripts/sample-scenes.mjs` draws the same samples for the all-theme tests.
 */
async function sampleScene(svg: string): Promise<Pick<SceneSource, 'sample' | 'surround'> | undefined> {
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SceneCatalog.resting(svg))}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = SCENE_SAMPLE.width
  canvas.height = SCENE_SAMPLE.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return undefined
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels: Rgb[] = []
  for (let index = 0; index + 2 < data.length; index += 4) pixels.push([data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0])
  return { sample: columnOfSample(pixels), surround: pixels }
}

/** Renderers that rasterise on the CPU: a WebGL context on one of them means the page is not composited on a GPU. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|lavapipe|softpipe|software|basic render/iu

/**
 * Whether the browser composites on a GPU, so a live `backdrop-filter` over the moving scene is cheap. A heuristic:
 * Chrome with hardware acceleration off (or blocklisted) has no WebGL, or only a software one, and refuses a context
 * that would carry a major performance caveat.
 */
function compositesOnGpu(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true })
    if (gl === null) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return !SOFTWARE_RENDERER.test(renderer)
  } catch {
    return false
  }
}

export default defineClient({
  name: '@dshfiles/ui-styles',
  inject: ['configForms'],
  setup(ctx) {
    // Before the settings mirror answers: the last custom theme, so a reload does not flash the default.
    const cached = RuntimeTheme.readCachedThemeCss()
    RuntimeTheme.applyThemeCss<HTMLElement>(document, cached)
    const form = ctx.configForms.get<Partial<AppearanceSettings>>(UI_STYLES_SETTINGS_NAMESPACE)
    const theme = createApiClient(ctx, themeApi)
    // Built-in scene SVGs come from the Host on first use, so the browser bundle never carries their builders.
    const scenes = new Map<string, SceneSource>()
    const loading = new Set<string>()
    const failed = new Set<string>()
    // The scenes themselves: inline and stepped at the chosen frame rate, never an animated image (scene-stage.ts).
    const stage = new SceneStage(document)
    let applied = cached
    let disposed = false
    const sync = (): void => {
      const snapshot = form.getSnapshot()
      if (snapshot.status === 'loading') return
      const value = snapshot.status === 'ready' ? snapshot.value : undefined
      // The slot names follow the theme at once; the slot colours come with its CSS below.
      RuntimeTheme.applyPaletteNames(document.documentElement, value === undefined ? {} : AppearanceModel.identityNames(value))
      const missing = AppearanceModel.scenesNeeded(value).filter(id => !scenes.has(id) && !failed.has(id))
      for (const id of missing) {
        if (loading.has(id)) continue
        loading.add(id)
        theme.scene({ id }).then(
          async ({ svg }) => {
            // The sample decides the readability veil; without it the theme falls back to a safe one.
            const sampled = await sampleScene(svg).catch(() => undefined)
            scenes.set(id, sampled === undefined ? { svg } : { svg, ...sampled })
            loading.delete(id)
            if (!disposed) sync()
          },
          (error: unknown) => {
            // The theme still applies without its scene; the colours and any layers stay.
            console.warn(`dshfiles-ui-styles: the backdrop scene "${id}" could not be loaded`, error)
            failed.add(id)
            loading.delete(id)
            if (!disposed) sync()
          },
        )
      }
      const painted = AppearanceModel.scenesNeeded(value).flatMap(id => {
        const source = scenes.get(id)
        return source === undefined ? [] : [{ id, svg: source.svg }]
      })
      stage.update(painted, AppearanceModel.sceneFrameRate(value))
      // Keep the cached sheet (which holds the scene's stills) until the scene arrives, instead of flashing a bare theme.
      if (missing.length > 0 && applied !== '') return
      // `unavailable` is a Host that predates the Appearance settings (or has none): the static default applies.
      const css = value === undefined ? '' : AppearanceModel.runtimeThemeCss(value, scenes)
      RuntimeTheme.applyThemeCss<HTMLElement>(document, css)
      RuntimeTheme.writeCachedThemeCss(css)
      applied = css
    }
    ctx.effect(() => {
      // Read once: the reading veil's CSS holds both blurs and this attribute picks one.
      document.body.toggleAttribute(GPU_ATTRIBUTE, compositesOnGpu())
      sync()
      void ctx.configForms.describe().ensure()
      const unsubscribe = form.subscribe(sync)
      return () => {
        disposed = true
        unsubscribe()
        stage.dispose()
        document.body.removeAttribute(GPU_ATTRIBUTE)
        document.getElementById(RUNTIME_STYLE_ID)?.remove()
        document.documentElement.removeAttribute(PALETTE_NAMES_ATTRIBUTE)
      }
    }, 'dshfiles-ui-styles: apply the Appearance theme')
    // The phone sheet geometry lives in this bundle's sheet, so its drag gesture does too: one listener for every sheet.
    ctx.effect(() => installSheetDrag(document), 'dshfiles-ui-styles: drag phone bottom sheets')
  },
})
