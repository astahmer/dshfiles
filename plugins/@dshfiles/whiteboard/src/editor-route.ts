/** Absolute pathname prefix the editor bundle, its chunks and the Excalidraw fonts are served under. */
export const EDITOR_ASSET_ROUTE = '/dshfiles-whiteboard/editor'
/** The entry module the Client imports; its name never changes, so it is the one file served `no-cache`. */
export const EDITOR_ENTRY_FILE = 'whiteboard-editor.js'
/** Where the Client leaves the Host's React for the editor bundle, which imports it instead of shipping a copy. */
export const EDITOR_RUNTIME_GLOBAL = '__dshfilesWhiteboardRuntime'
/** The module specifiers the editor bundle reads from {@link EDITOR_RUNTIME_GLOBAL}. */
export const EDITOR_RUNTIME_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] as const
export type EditorRuntimeModule = (typeof EDITOR_RUNTIME_MODULES)[number]
