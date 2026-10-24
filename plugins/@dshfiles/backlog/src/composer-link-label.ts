import type { BacklogLink } from './item.js'
import { workspaceReferenceLabel } from './workspace-reference-label.js'

export const composerLinkLabel = (link: Pick<BacklogLink, 'type' | 'target'>, threads: readonly { readonly id: string; readonly title: string }[]): string => {
  if (link.type === 'item') return `b:${link.target}`
  if (link.type === 'workspace') return workspaceReferenceLabel(link.target)
  if (link.type !== 'thread') return link.target
  return threads.find(thread => thread.id === link.target)?.title ?? link.target
}
