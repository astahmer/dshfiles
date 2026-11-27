import { BoardView } from './board-view.js'
import { BoardsPanel } from './boards-panel.js'

// The boards list and the board view share the board store and API calls, so they load as one lazy chunk: two chunks may not bundle the same plugin module.
export const LazyViews = { BoardView, BoardsPanel }
