import type { ComponentType } from 'react'
import type { PendingSource, Scene } from './model.js'

/**
 * The surface of the lazily loaded editor bundle (`src/editor/entry.tsx`). The Client imports only these types, so
 * `client.js` never pulls Excalidraw in.
 */
export interface EditorHandle {
  /** The current scene in its persisted shape: live elements, background/grid and the images they use. */
  readonly scene: () => Scene
  /** Replace the canvas with a scene another writer saved; it is not reported back as a local edit. */
  readonly replaceScene: (scene: Scene) => void
  /** Append converted elements beside the existing drawing and return the resulting scene. */
  readonly appendElements: (input: { readonly elements: Scene['elements']; readonly files: Scene['files'] }) => Scene
}

export interface WhiteboardCanvasProps {
  readonly initialScene: Scene
  readonly theme: 'light' | 'dark'
  /** A user edit changed the drawing (elements, images or background); selection and scrolling do not count. */
  readonly onChange: (scene: Scene) => void
  readonly onReady: (handle: EditorHandle) => void
}

export interface ConvertedSource {
  readonly elements: Scene['elements']
  readonly files: Scene['files']
}

export interface EditorModule {
  readonly WhiteboardCanvas: ComponentType<WhiteboardCanvasProps>
  /** Turn Mermaid or skeleton source an agent queued into Excalidraw elements; needs the browser DOM. */
  readonly convertPending: (pending: PendingSource) => Promise<ConvertedSource>
}
