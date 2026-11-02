import * as Option from 'effect/Option'
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

const coordinate = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(-100_000), Schema.isLessThanOrEqualTo(100_000))

const agentReferencePreviewEvent = 'dshfiles:agent-reference-preview'

const agentReferencePreviewRequestSchema = Schema.Struct({
  handle: Schema.String.check(Schema.isPattern(AGENT_HANDLE_PATTERN)),
  /** The decorated element the card follows: it re-measures this anchor instead of closing when the page scrolls. */
  anchorId: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  anchor: Schema.Struct({
    left: coordinate,
    top: coordinate,
    width: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100_000)),
    height: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100_000)),
  }),
})

type AgentReferencePreviewRequest = typeof agentReferencePreviewRequestSchema.Type

const agentReferenceLabel = (handle: string): string => `@${handle}`

/** The request a card receives; unknown keys still fail, as the zod strict object did. */
const decodeAgentReferencePreviewRequest = (value: unknown): Option.Option<AgentReferencePreviewRequest> =>
  Schema.decodeUnknownOption(agentReferencePreviewRequestSchema, { onExcessProperty: 'error' })(value)

export class AgentReference {
  static readonly matches = agentReferenceMatches
  static readonly previewEvent = agentReferencePreviewEvent
  static readonly previewRequestSchema = agentReferencePreviewRequestSchema
  static readonly label = agentReferenceLabel
  static readonly decodePreviewRequest = decodeAgentReferencePreviewRequest
}

export type { AgentReferencePreviewRequest }
