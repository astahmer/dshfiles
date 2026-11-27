// The boards list and the board view share the board store and API calls, so they load as one lazy chunk: two chunks may not bundle the same plugin module.
export { BoardView } from './board-view.js'
export { BoardsPanel } from './boards-panel.js'
