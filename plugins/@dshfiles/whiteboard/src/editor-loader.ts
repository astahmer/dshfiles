import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import type { EditorModule } from './editor-contract.js'
import { EDITOR_ASSET_ROUTE, EDITOR_ENTRY_FILE, EDITOR_RUNTIME_GLOBAL, EDITOR_RUNTIME_MODULES } from './editor-route.js'

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

/** The page's React modules, keyed by the specifiers the editor bundle imports. */
interface EditorRuntime {
  readonly react: typeof React
  readonly 'react/jsx-runtime': typeof ReactJsxRuntime
  readonly 'react-dom': typeof ReactDom
  readonly 'react-dom/client': typeof ReactDomClient
}

const runtime: EditorRuntime = {
  react: React,
  'react/jsx-runtime': ReactJsxRuntime,
  'react-dom': ReactDom,
  'react-dom/client': ReactDomClient,
}

/** Thrown when the editor bundle cannot be fetched or does not export the editor surface. */
export class EditorLoadFailed extends Error {
  override readonly name = 'EditorLoadFailed'
}

let loading: Promise<EditorModule> | null = null

/**
 * Imports the Excalidraw editor bundle the Host serves at {@link EDITOR_ASSET_ROUTE}, once per page. It runs on the
 * page's own React (left on a global the bundle reads), and Excalidraw's fonts load from the same route. A failure
 * is not cached, so Retry fetches again.
 */
export const loadEditor = (origin: string = window.location.origin): Promise<EditorModule> => {
  if (loading !== null) return loading
  Reflect.set(globalThis, EDITOR_RUNTIME_GLOBAL, Object.fromEntries(EDITOR_RUNTIME_MODULES.map(module => [module, runtime[module]])))
  window.EXCALIDRAW_ASSET_PATH = `${origin}${EDITOR_ASSET_ROUTE}/`
  const url = `${origin}${EDITOR_ASSET_ROUTE}/${EDITOR_ENTRY_FILE}`
  // A computed specifier: the Client build leaves this a native browser import of the Host route, which serves
  // this package's own `dist/editor` build.
  const importEditor = (specifier: string): Promise<{ readonly default?: Partial<EditorModule> }> => import(/* @vite-ignore */ specifier)
  const pending = importEditor(url).then(
    (namespace): EditorModule => {
      const candidate = namespace.default
      if (candidate?.WhiteboardCanvas === undefined || candidate.convertPending === undefined)
        throw new EditorLoadFailed('The whiteboard editor bundle is out of date. Rebuild @dshfiles/whiteboard, then reload the page.')
      return { WhiteboardCanvas: candidate.WhiteboardCanvas, convertPending: candidate.convertPending }
    },
    (cause: unknown) => {
      throw new EditorLoadFailed(
        `The whiteboard editor could not be downloaded (${cause instanceof Error ? cause.message : String(cause)}). Check the connection to DSH and retry.`,
      )
    },
  )
  loading = pending
  pending.catch(() => {
    loading = null
  })
  return pending
}
