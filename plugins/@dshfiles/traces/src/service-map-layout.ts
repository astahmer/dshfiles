export type MapEdgeInput = { readonly source: string; readonly target: string }

export type PlacedNode = { readonly service: string; readonly column: number; readonly row: number }

export type MapLayout = { readonly nodes: readonly PlacedNode[]; readonly columns: number; readonly rows: number }

/**
 * Columns by the longest call chain reaching a service (callers left of callees), rows in name order within a column.
 * A cycle cannot push a service further right than the number of services, so the loop always ends.
 */
const layout = (services: readonly string[], edges: readonly MapEdgeInput[]): MapLayout => {
  const all = [...new Set([...services, ...edges.flatMap(edge => [edge.source, edge.target])])].sort()
  const depth = new Map(all.map(service => [service, 0]))
  const limit = Math.max(0, all.length - 1)
  for (let pass = 0; pass < all.length; pass++) {
    let changed = false
    for (const edge of edges) {
      if (edge.source === edge.target) continue
      const next = Math.min(limit, (depth.get(edge.source) ?? 0) + 1)
      if (next > (depth.get(edge.target) ?? 0)) {
        depth.set(edge.target, next)
        changed = true
      }
    }
    if (!changed) break
  }
  const rowsUsed = new Map<number, number>()
  const nodes = all.map(service => {
    const column = depth.get(service) ?? 0
    const row = rowsUsed.get(column) ?? 0
    rowsUsed.set(column, row + 1)
    return { service, column, row }
  })
  return {
    nodes,
    columns: nodes.length === 0 ? 0 : Math.max(...nodes.map(node => node.column)) + 1,
    rows: nodes.length === 0 ? 0 : Math.max(...rowsUsed.values()),
  }
}

export class ServiceMapLayout {
  static readonly layout = layout
}
