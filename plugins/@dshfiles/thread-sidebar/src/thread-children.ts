export interface ThreadNode {
  readonly id: string
  readonly parentId?: string
  readonly updatedAt: number
}

export const threadActionTargetIds = <Thread extends ThreadNode>(options: {
  readonly threadId: Thread['id']
  readonly threads: readonly Thread[]
  readonly cascadeToChildren: boolean
}): Thread['id'][] => {
  const targets = [options.threadId]
  if (!options.cascadeToChildren) return targets

  const childrenByParent = new Map<string, Thread['id'][]>()
  for (const thread of options.threads) {
    if (thread.parentId === undefined) continue
    const children = childrenByParent.get(thread.parentId) ?? []
    children.push(thread.id)
    childrenByParent.set(thread.parentId, children)
  }

  const visited = new Set(targets)
  for (let index = 0; index < targets.length; index += 1) {
    const parentId = targets[index]
    if (parentId === undefined) continue
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (visited.has(childId)) continue
      visited.add(childId)
      targets.push(childId)
    }
  }
  return targets
}

export interface ThreadTree<Thread extends ThreadNode> {
  /** Threads rendered as their own sidebar row, in input order. */
  readonly roots: readonly Thread[]
  /** Descendants folded under their top-most listed ancestor, newest first. */
  readonly childrenByRoot: ReadonlyMap<string, readonly Thread[]>
}

/**
 * Fold every thread under its top-most ancestor that is itself listed, regardless
 * of which sidebar section would otherwise contain it. A child whose ancestors
 * are all missing (filtered or blank) stays a root row, and a visited set keeps
 * corrupt parent cycles bounded.
 */
export const groupThreadChildren = <Thread extends ThreadNode>(options: { readonly threads: readonly Thread[] }): ThreadTree<Thread> => {
  const listed = new Map(options.threads.map(thread => [thread.id, thread]))
  const rootOf = (thread: Thread): Thread | undefined => {
    let root: Thread | undefined
    let cursor = thread.parentId
    const visited = new Set<string>([thread.id])
    while (cursor !== undefined && !visited.has(cursor)) {
      visited.add(cursor)
      const ancestor = listed.get(cursor)
      if (ancestor === undefined) break
      root = ancestor
      cursor = ancestor.parentId
    }
    return root
  }

  const roots: Thread[] = []
  const childrenByRoot = new Map<string, Thread[]>()
  for (const thread of options.threads) {
    const root = rootOf(thread)
    if (root === undefined) {
      roots.push(thread)
      continue
    }
    const children = childrenByRoot.get(root.id) ?? []
    children.push(thread)
    childrenByRoot.set(root.id, children)
  }
  for (const children of childrenByRoot.values()) children.sort((left, right) => right.updatedAt - left.updatedAt)
  return { roots, childrenByRoot }
}

/**
 * The child rows a parent shows: the first `limit`, or all of them once expanded.
 * A selected child past the limit still shows so the open thread is never hidden.
 */
export const visibleChildren = <Thread extends { readonly id: string }>(options: {
  readonly children: readonly Thread[]
  readonly limit: number
  readonly showAll: boolean
  readonly selectedId: string | undefined
}): { readonly shown: readonly Thread[]; readonly hiddenCount: number } => {
  if (options.showAll || options.children.length <= options.limit) return { shown: options.children, hiddenCount: 0 }
  const shown = options.children.filter((child, index) => index < options.limit || child.id === options.selectedId)
  return { shown, hiddenCount: options.children.length - shown.length }
}
