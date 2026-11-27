// The MCP manager and quick panel share their server rows and API calls, so they load as one lazy chunk: two chunks may not bundle the same plugin module.
export { ManagerView } from './manager-view.js'
export { McpQuickPanel } from './mcp-quick-panel.js'
