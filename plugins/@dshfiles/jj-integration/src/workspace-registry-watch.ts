import type { WorkspaceListRow, WorkspaceListStore } from '@dshfiles/plugin-ui/lib/workspace-listed'

const registrySignature = (items: readonly WorkspaceListRow[]): string =>
  items
    .map(item => item.workspaceId)
    .toSorted()
    .join('\n')

/**
 * Calls `onChange` when a Workspace is registered or removed. Each plugin bundle owns its own query cache, so a project
 * another plugin registers (the sidebar's Add workspace, an agent tool) cannot invalidate this plugin's project list;
 * the Client Workspace list every plugin observes is the signal that the registry changed.
 */
export const watchWorkspaceRegistry = <Row extends WorkspaceListRow>(input: {
  readonly workspaces: WorkspaceListStore<Row>
  readonly onChange: () => void
}): (() => void) => {
  let seen = registrySignature(input.workspaces.list.getSnapshot().items)
  return input.workspaces.list.subscribe(() => {
    const next = registrySignature(input.workspaces.list.getSnapshot().items)
    if (next === seen) return
    seen = next
    input.onChange()
  })
}
