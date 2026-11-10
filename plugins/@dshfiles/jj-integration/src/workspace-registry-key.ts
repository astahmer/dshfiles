/** The registered Workspaces as one order-independent cache key: it changes only when one is added or removed. */
export const workspaceRegistryKey = (items: readonly { readonly workspaceId: string }[]): string =>
  items
    .map(item => item.workspaceId)
    .toSorted()
    .join('\n')
