import * as Schema from 'effect/Schema'

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
const agentReferenceMatches = (text: string, handles: ReadonlySet<string>): readonly AgentReferenceMatch[] =>
  [...text.matchAll(mentionPattern)].flatMap(match => {
    const handle = match[1] ?? match[2]
    if (handle === undefined || !handles.has(handle)) return []
    const start = match.index ?? 0
    return [{ handle, start, end: start + match[0].length }]
  })

const agentReferenceLabel = (handle: string): string => `@${handle}`

const isAgentHandle = (value: string): boolean => Schema.is(Schema.String.check(Schema.isPattern(AGENT_HANDLE_PATTERN)))(value)

export class AgentReference {
  static readonly matches = agentReferenceMatches
  /** The kind agents registers in input-trigger's entity registry; the shared reference card is keyed by it. */
  static readonly entityKind = 'agent'
  static readonly label = agentReferenceLabel
  static readonly isHandle = isAgentHandle
}
