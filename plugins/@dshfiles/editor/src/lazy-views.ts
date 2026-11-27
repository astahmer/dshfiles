// The editor and Artifacts pages share the file list and editor chrome, so they load as one lazy chunk: two chunks may not bundle the same plugin module.
export { ArtifactsPanel } from './artifacts-panel.js'
export { EditorPanel } from './editor-panel.js'
