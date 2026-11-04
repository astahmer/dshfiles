import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  getCommonBounds,
  getNonDeletedElements,
  hashElementsVersion,
  restoreElements,
} from '@excalidraw/excalidraw'
import excalidrawCss from '@excalidraw/excalidraw/index.css?inline'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useEffect, useRef, useState, type JSX } from 'react'
import type { ConvertedSource, EditorHandle, EditorModule, WhiteboardCanvasProps } from '../editor-contract.js'
import type { PendingSource, Scene } from '../model.js'

const STYLE_ID = 'dshfiles-whiteboard-excalidraw-css'
/** Gap between an existing drawing and elements converted from queued source. */
const APPEND_GAP = 120

/** Excalidraw's stylesheet, injected once when the editor first mounts; it is scoped under `.excalidraw`. */
const ensureStyles = (): void => {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = excalidrawCss
  document.head.append(style)
}

/** Excalidraw elements and image data are plain JSON objects, so they are the scene's opaque records as they are. */
const asRecords = (elements: readonly ExcalidrawElement[]): Scene['elements'] => elements
const asFileRecords = (files: BinaryFiles): Scene['files'] => files
const asElements = (elements: Scene['elements']): ExcalidrawElement[] =>
  // SAFETY: the Host stores what this editor produced; `restoreElements` repairs or drops anything an agent wrote by hand.
  restoreElements(elements as readonly ExcalidrawElement[], null, { repairBindings: true })
// SAFETY: image data is stored exactly as Excalidraw's `onChange` reported it.
const asFiles = (files: Scene['files']): BinaryFiles => files as BinaryFiles

/** The persisted scene: live elements, the images they reference and the background/grid. */
const persistedScene = (elements: readonly ExcalidrawElement[], appState: Pick<AppState, 'viewBackgroundColor' | 'gridSize'>, files: BinaryFiles): Scene => {
  const live = getNonDeletedElements(elements)
  const used = new Set<string>(live.flatMap(element => (element.type === 'image' && element.fileId !== null ? [element.fileId] : [])))
  const keptFiles: BinaryFiles = {}
  for (const [id, file] of Object.entries(files)) if (used.has(id)) keptFiles[id] = file
  return {
    elements: asRecords(live),
    appState: { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize },
    files: asFileRecords(keptFiles),
  }
}

/** What counts as an edit: element versions, the background colour or the set of images. */
const fingerprint = (scene: Scene): string =>
  `${String(hashElementsVersion(asElements(scene.elements)))}|${scene.appState.viewBackgroundColor ?? ''}|${Object.keys(scene.files).sort().join(',')}`

/** What Excalidraw opens with: the stored elements, images and background, scrolled to the drawing. */
const initialData = (scene: Scene) => {
  const appState: Partial<AppState> = { viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff' }
  if (scene.appState.gridSize !== undefined && scene.appState.gridSize !== null) appState.gridSize = scene.appState.gridSize
  return { elements: asElements(scene.elements), appState, files: asFiles(scene.files), scrollToContent: true }
}

const WhiteboardCanvas = (props: WhiteboardCanvasProps): JSX.Element => {
  ensureStyles()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const lastFingerprint = useRef(fingerprint(props.initialScene))
  const onChange = useRef(props.onChange)
  onChange.current = props.onChange
  const onReady = useRef(props.onReady)
  onReady.current = props.onReady

  useEffect(() => {
    if (api === null) return
    const current = (): Scene => persistedScene(api.getSceneElements(), api.getAppState(), api.getFiles())
    const handle: EditorHandle = {
      scene: current,
      replaceScene: scene => {
        lastFingerprint.current = fingerprint(scene)
        api.addFiles(Object.values(asFiles(scene.files)))
        api.updateScene({
          elements: asElements(scene.elements),
          appState: { viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff' },
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      },
      appendElements: input => {
        const existing = getNonDeletedElements(api.getSceneElements())
        const added = asElements(input.elements)
        const offset =
          existing.length === 0 || added.length === 0
            ? { x: 0, y: 0 }
            : (() => {
                const [, existingTop, existingRight] = getCommonBounds(existing)
                const [addedLeft, addedTop] = getCommonBounds(added)
                return { x: existingRight + APPEND_GAP - addedLeft, y: existingTop - addedTop }
              })()
        const moved = added.map(element => ({ ...element, x: element.x + offset.x, y: element.y + offset.y }))
        const files: BinaryFileData[] = Object.values(asFiles(input.files))
        if (files.length > 0) api.addFiles(files)
        api.updateScene({ elements: [...api.getSceneElements(), ...moved], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
        const scene = current()
        lastFingerprint.current = fingerprint(scene)
        api.scrollToContent(moved, { fitToContent: true, animate: true })
        return scene
      },
    }
    onReady.current(handle)
  }, [api])

  return (
    <div className="dshfiles-whiteboard-canvas" style={{ position: 'absolute', inset: 0 }}>
      <Excalidraw
        excalidrawAPI={setApi}
        theme={props.theme}
        initialData={initialData(props.initialScene)}
        UIOptions={{ canvasActions: { saveToActiveFile: false } }}
        onChange={(elements, appState, files) => {
          const scene = persistedScene(elements, appState, files)
          const next = fingerprint(scene)
          if (next === lastFingerprint.current) return
          lastFingerprint.current = next
          onChange.current(scene)
        }}
      />
    </div>
  )
}

/** Converts queued source in the browser: Mermaid needs the DOM to lay out, skeletons need text measurement. */
const convertPending = async (pending: PendingSource): Promise<ConvertedSource> => {
  if (pending.kind === 'skeleton') {
    // SAFETY: skeleton entries are validated by Excalidraw's converter, which skips the ones it cannot place.
    const skeleton = pending.elements as readonly ExcalidrawElementSkeleton[]
    return { elements: asRecords(convertToExcalidrawElements([...skeleton], { regenerateIds: false })), files: {} }
  }
  const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw')
  const parsed = await parseMermaidToExcalidraw(pending.source)
  return { elements: asRecords(convertToExcalidrawElements(parsed.elements, { regenerateIds: true })), files: asFileRecords(parsed.files ?? {}) }
}

const editorModule: EditorModule = { WhiteboardCanvas, convertPending }

export default editorModule
