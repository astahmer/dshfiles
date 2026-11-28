import { TracesPanel } from './panel.js'
import { SessionRequestsView } from './session-requests-view.js'
import { SessionTracesView } from './session-view.js'

// The Traces page and the thread's Traces and Requests views share the trace detail and the API contract, so they load
// as one lazy chunk when the first opens: two chunks may not bundle the same plugin module.
export const LazyViews = { TracesPanel, SessionRequestsView, SessionTracesView }
