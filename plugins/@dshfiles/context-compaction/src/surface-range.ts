import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import type { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'

/** The stock summarizer input; compaction-basic does not export the type from its entry. */
export type SummarizationInput = Parameters<BasicCompactionEngine['summarize']>[0]

export interface SurfaceRange {
  readonly start: SessionSeq
  readonly end: SessionSeq
}

interface PricedNode {
  readonly seq: SessionSeq
  readonly tokens: number
}

const hasSystemHead = (session: Session) => {
  const head = session.surface.nodes[0]
  return head !== undefined && session.eventAt(head)?.type === 'system/message'
}

/**
 * The range compaction-basic's `selectCompactableRange` (not exported) picks: from the first non-system surface node
 * up to the retained tail of at least `retainTokens`, never splitting a tool call from its result. Null when no
 * useful range exists or the meter's nodes no longer match the surface.
 */
export const selectCompactableRange = (input: {
  readonly session: Session
  readonly nodes: readonly PricedNode[]
  readonly retainTokens: number
}): SurfaceRange | null => {
  const surfaceNodes = input.session.surface.nodes
  if (input.nodes.length === 0 || surfaceNodes.length !== input.nodes.length) return null
  if (surfaceNodes.some((seq, index) => seq !== input.nodes[index]?.seq)) return null
  const firstIndex = hasSystemHead(input.session) ? 1 : 0
  let accumulated = 0
  let keepFromIndex = input.nodes.length
  for (let index = input.nodes.length - 1; index >= 0; index -= 1) {
    accumulated += input.nodes[index]?.tokens ?? 0
    keepFromIndex = index
    if (accumulated >= input.retainTokens) break
  }
  while (keepFromIndex > firstIndex) {
    const keepFrom = surfaceNodes[keepFromIndex]
    if (keepFrom !== undefined && toolPairingBalancedBefore(input.session, keepFrom)) break
    keepFromIndex -= 1
  }
  const start = surfaceNodes[firstIndex]
  const end = surfaceNodes[keepFromIndex - 1]
  if (keepFromIndex <= firstIndex || start === undefined || end === undefined) return null
  return { start, end }
}

/**
 * The summary input compaction-basic's `buildSummarizationInput` (not exported) replays for one range: the system
 * head, the header's tools, then the range's derived messages. Null when the range is no longer a contiguous,
 * balanced span of the current surface.
 */
export const summarizationInputFor = (session: Session, range: SurfaceRange): SummarizationInput | null => {
  const nodes = session.surface.nodes
  const startIndex = nodes.indexOf(range.start)
  const endIndex = nodes.indexOf(range.end)
  if (startIndex === -1 || endIndex < startIndex) return null
  if (!toolPairingBalancedBefore(session, range.start) || !toolPairingBalancedAfter(session, range.end)) return null
  const head = nodes[0]
  const headEvent = head === undefined || !hasSystemHead(session) ? undefined : session.eventAt(head)
  const system = headEvent === undefined ? null : session.deriveEventMessage(headEvent)
  const regionMessages = nodes.slice(startIndex, endIndex + 1).flatMap((seq): Message[] => {
    const event = session.eventAt(seq)
    const message = event === undefined ? null : session.deriveEventMessage(event)
    return message === null ? [] : [message]
  })
  const tools = session.requestHeader()?.tools
  const messages = system === null ? regionMessages : [system, ...regionMessages]
  return tools === undefined ? { messages } : { messages, tools }
}
