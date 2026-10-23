export type TreeInput = { readonly spanId: string; readonly parentSpanId: string | null; readonly startUs: number }

export type TreeEntry<Span extends TreeInput> = { readonly span: Span; readonly depth: number; readonly childCount: number }

/**
 * Orders a trace's spans depth-first, children by start time. A span whose parent is missing (not received yet,
 * pruned, or from another process that never exported) is a root, so a partial trace still renders.
 */
export const buildSpanTree = <Span extends TreeInput>(spans: readonly Span[]): TreeEntry<Span>[] => {
  const byStart = [...spans].sort((left, right) => left.startUs - right.startUs || left.spanId.localeCompare(right.spanId))
  const known = new Set(byStart.map(span => span.spanId))
  const children = new Map<string, Span[]>()
  const roots: Span[] = []
  for (const span of byStart) {
    if (span.parentSpanId === null || span.parentSpanId === span.spanId || !known.has(span.parentSpanId)) {
      roots.push(span)
      continue
    }
    const siblings = children.get(span.parentSpanId)
    if (siblings === undefined) children.set(span.parentSpanId, [span])
    else siblings.push(span)
  }
  const ordered: TreeEntry<Span>[] = []
  const visited = new Set<string>()
  const stack: { readonly span: Span; readonly depth: number }[] = roots.toReversed().map(span => ({ span, depth: 0 }))
  while (stack.length > 0) {
    const next = stack.pop()
    if (next === undefined || visited.has(next.span.spanId)) continue
    visited.add(next.span.spanId)
    const ownChildren = children.get(next.span.spanId) ?? []
    ordered.push({ span: next.span, depth: next.depth, childCount: ownChildren.length })
    for (const child of ownChildren.toReversed()) stack.push({ span: child, depth: next.depth + 1 })
  }
  // A parent cycle never reaches a root; list those spans flat rather than dropping them.
  for (const span of byStart) if (!visited.has(span.spanId)) ordered.push({ span, depth: 0, childCount: 0 })
  return ordered
}
