type ClientSetup = { id: string; label: string; snippet: string; installUrl?: string }

export const clientSetups = ({ url, token }: { readonly url: string; readonly token: string | undefined }) => {
  const authorization = `Bearer ${token ?? '${env:DSH_MCP_TOKEN}'}`
  const headers = { Authorization: authorization }
  const cursor = { url, headers }
  const cursorEntry: ClientSetup = {
    id: 'cursor',
    label: 'Cursor',
    snippet: JSON.stringify({ mcpServers: { dsh: cursor } }, null, 2),
  }
  if (token !== undefined)
    cursorEntry.installUrl = `cursor://anysphere.cursor-deeplink/mcp/install?name=dsh&config=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(cursor)))))}`
  const vscode = { name: 'dsh', type: 'http', url, headers }
  const codex = `codex mcp add dsh --url ${url} --bearer-token-env-var DSH_MCP_TOKEN`
  return [
    { id: 'claude', label: 'Claude Code', snippet: `claude mcp add --transport http dsh ${url} --header "Authorization: Bearer ${token ?? '$DSH_MCP_TOKEN'}"` },
    { id: 'codex', label: 'Codex', snippet: token === undefined ? codex : `export DSH_MCP_TOKEN=${token}\n${codex}` },
    cursorEntry,
    { id: 'vscode', label: 'VS Code', snippet: `code --add-mcp '${JSON.stringify(vscode)}'` },
    { id: 'json', label: 'JSON', snippet: JSON.stringify({ mcpServers: { dsh: { type: 'http', url, headers } } }, null, 2) },
  ]
}
