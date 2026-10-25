import { z } from 'zod'

import { AGENT_HANDLE_PATTERN } from './agent.js'

/**
 * Agent references use `@{luna}`; ordinary `@handle` mentions remain supported for existing messages. The leading
 * boundary keeps email addresses out, and `(?!:)` keeps the `@agent:`/`@a:` menu scopes from matching a handle.
 */
const mentionPattern = /(?<![\w@/])@\{([a-z][a-z0-9-]{0,31})\}(?![\w-])|(?<![\w@/])@([a-z][a-z0-9-]{0,31})\b(?!:)/gu

export interface AgentReferenceMatch {
  readonly handle: string
  /** Offset of the leading `@` in the scanned text. */
  readonly start: number
  readonly end: number
}

/** The `@handle` tokens naming one of `handles`; an unknown or disabled agent's mention stays plain text. */
export const agentReferenceMatches = (text: string, handles: ReadonlySet<string>): readonly AgentReferenceMatch[] =>
  [...text.matchAll(mentionPattern)].flatMap(match => {
    const handle = match[1] ?? match[2]
    if (handle === undefined || !handles.has(handle)) return []
    const start = match.index ?? 0
    return [{ handle, start, end: start + match[0].length }]
  })

const coordinate = z.number().finite().min(-100_000).max(100_000)

export const agentReferencePreviewEvent = 'dshfiles:agent-reference-preview'

export const agentReferencePreviewRequestSchema = z
  .object({
    handle: z.string().regex(AGENT_HANDLE_PATTERN),
    /** The decorated element the card follows: it re-measures this anchor instead of closing when the page scrolls. */
    anchorId: z.number().int().positive(),
    anchor: z
      .object({
        left: coordinate,
        top: coordinate,
        width: z.number().finite().min(0).max(100_000),
        height: z.number().finite().min(0).max(100_000),
      })
      .strict(),
  })
  .strict()

export type AgentReferencePreviewRequest = z.infer<typeof agentReferencePreviewRequestSchema>

export const agentReferenceLabel = (handle: string): string => `@${handle}`
