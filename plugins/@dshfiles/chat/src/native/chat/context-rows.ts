/**
 * dshfiles (unslop T1): which Context rows are plumbing.
 *
 * Every Turn starts with the context the Host injects on its own (runtime-context, skill-catalog, time-context,
 * workspace instructions). Those rows led each Turn and were the only content of a running one, so they show only in
 * the Verbose view mode. A recalled thread and a tool-list change stay in every mode: they answer something the user
 * did. The Context panel still lists everything a thread loads.
 */
import type { ChatNode } from '../contract/chat-nodes.ts'

type ContextData = Pick<ChatNode<'context'>['data'], 'content' | 'producer'>

/** Whether a Context row is one the Host injects on its own, as opposed to a recall or a tool-list change. */
export function isRoutineContext(data: ContextData): boolean {
  if (data.producer.role === 'recall') return false
  const toolChange = data.content.length > 0
    && data.content.every(block => block.type === 'tool-addition' || block.type === 'tool-removal')
  return !toolChange
}

/** Whether a Chat Node is a routine Context row. */
export function isRoutineContextNode(node: Pick<ChatNode, 'kind' | 'data'> | undefined): boolean {
  return node?.kind === 'context' && isRoutineContext(node.data as ContextData)
}

/** Routine Context rows show only where every step stays open as its own row. */
export function showsRoutineContext(mode: string): boolean {
  return mode === 'verbose'
}
