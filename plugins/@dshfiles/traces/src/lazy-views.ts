// The Traces page and the thread's Traces and Requests views share the trace detail and the API contract, so they load
// as one lazy chunk when the first opens: two chunks may not bundle the same plugin module.
export { TracesPanel } from './panel.js'
export { SessionRequestsView } from './session-requests-view.js'
export { SessionTracesView } from './session-view.js'
