/**
 * dshfiles: consecutive subagent delegations in one process group read as one collapsible block.
 * Pure facts only; `ChatGroupSeat` renders the block and owns its presentation-only open state.
 */
import type { ChatConversationViewNode, ChatNode } from '../contract/chat-nodes.ts'
import { isSubagentDelegationTool } from '../contract/turn-process.ts'

/** What a block header needs from one delegation row. */
export interface SubagentCall {
  /** The delegation call itself has not returned yet. */
  readonly calling: boolean
  /** Child Session named by a background delegation's result (`started subagent <id>`). */
  readonly childId: string | undefined
}

/** A member rendered alone, or a run of two or more consecutive delegations. */
export type SubagentSegment<Member> =
  | { readonly kind: 'member'; readonly member: Member; readonly index: number }
  | { readonly kind: 'subagents'; readonly members: readonly Member[]; readonly calls: readonly SubagentCall[] }

const NOT_SUBAGENT = '-'

/**
 * Read one Node as a delegation row.
 * @param node - Chat Node, when materialized.
 * @returns the delegation facts, or undefined for any other Node.
 */
export function subagentCallOf(node: ChatConversationViewNode | undefined): SubagentCall | undefined {
  if (node?.kind !== 'tool-call') return undefined
  // SAFETY: the view node's `kind` discriminates its data, as ChatNodeSeat's keyed dispatch relies on.
  const root = (node as ChatNode<'tool-call'>).data.root
  const name = 'kind' in root ? root.name || (root.call?.name ?? '') : root.name
  if (!isSubagentDelegationTool(name)) return undefined
  if (!('kind' in root)) return { calling: true, childId: undefined }
  const text = root.isError ? '' : root.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n')
  return { calling: false, childId: text.trim().match(/^started subagent (\S+)$/)?.[1] }
}

/**
 * Encode the delegation facts of a member list as one comparable string, so a seat can subscribe
 * to every member and re-render only when a member enters, leaves, or changes delegation state.
 * @param calls - facts per member, in member order.
 * @returns a primitive signature `decodeSubagentSignature` reverses.
 */
export function encodeSubagentSignature(calls: readonly (SubagentCall | undefined)[]): string {
  return calls.map(call => call === undefined ? NOT_SUBAGENT : call.calling ? 'c' : `d${call.childId ?? ''}`).join('\n')
}

/**
 * @param signature - value from `encodeSubagentSignature`.
 * @returns facts per member, in member order.
 */
export function decodeSubagentSignature(signature: string): readonly (SubagentCall | undefined)[] {
  if (signature === '') return []
  return signature.split('\n').map((part): SubagentCall | undefined => {
    if (part === NOT_SUBAGENT) return undefined
    if (part === 'c') return { calling: true, childId: undefined }
    const childId = part.slice(1)
    return { calling: false, childId: childId === '' ? undefined : childId }
  })
}

/**
 * Split members into single rows and runs of two or more consecutive delegations.
 * @param members - group members in render order.
 * @param calls - delegation facts per member, in the same order.
 * @returns segments covering every member exactly once, in order.
 */
export function segmentSubagentRuns<Member>(
  members: readonly Member[],
  calls: readonly (SubagentCall | undefined)[],
): readonly SubagentSegment<Member>[] {
  const segments: SubagentSegment<Member>[] = []
  let index = 0
  while (index < members.length) {
    let end = index
    while (end < members.length && calls[end] !== undefined) end += 1
    if (end - index >= 2) {
      segments.push({
        kind: 'subagents',
        members: members.slice(index, end),
        calls: calls.slice(index, end).filter((call): call is SubagentCall => call !== undefined),
      })
      index = end
      continue
    }
    segments.push({ kind: 'member', member: members[index] as Member, index })
    index += 1
  }
  return segments
}

/**
 * Count the delegations of a run that still work.
 * @param calls - the run's delegation facts.
 * @param childRunning - whether a child Session runs a turn now.
 * @returns delegations whose call is open or whose child runs.
 */
export function workingSubagents(calls: readonly SubagentCall[], childRunning: (childId: string) => boolean): number {
  return calls.filter(call => call.calling || (call.childId !== undefined && childRunning(call.childId))).length
}
