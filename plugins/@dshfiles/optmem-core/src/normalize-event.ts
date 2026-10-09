import { Redaction } from './redaction.ts'
import { StreamIds } from './stream-ids.ts'
import type { EventMeta, MemoryConfig, MemoryEventInput, NormalizedEvent } from './types.ts'
import { Utf8 } from './utf8.ts'

/** Redaction, exclusion and size bounds happen here, before anything is persisted. */
export const normalizeEvent = (input: MemoryEventInput, config: MemoryConfig): NormalizedEvent => {
  const isToolEvent = input.role === 'tool_call' || input.role === 'tool_result'
  const excluded = isToolEvent && input.toolName !== undefined && config.excludeTools.includes(input.toolName)
  const source = excluded ? `[excluded tool output: ${input.toolName}]` : input.text
  const redacted = Redaction.redact(source, config.redactLiterals)
  const bounded = Utf8.boundHeadTail(redacted.text, input.role === 'tool_result' ? config.toolResultMaxBytes : config.eventMaxBytes)
  const meta: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(input.meta ?? {})) {
    meta[key] = typeof value === 'string' ? Redaction.redact(value, config.redactLiterals).text : value
  }
  if (input.toolName !== undefined) meta['toolName'] = input.toolName
  if (redacted.count > 0) meta['redactions'] = redacted.count
  const frozenMeta: EventMeta = meta
  const projectId = input.projectId ?? null
  return {
    eventKey: input.eventKey,
    harness: input.harness,
    conversationId: input.conversationId,
    projectId,
    parentConversationId: input.parentConversationId ?? null,
    role: input.role,
    createdAt: input.createdAt,
    text: bounded.text,
    bytes: Utf8.byteLength(bounded.text),
    truncated: bounded.truncatedBytes > 0,
    meta: frozenMeta,
    streams: StreamIds.forEvent({ conversationId: input.conversationId, projectId, global: input.global === true }),
  }
}
