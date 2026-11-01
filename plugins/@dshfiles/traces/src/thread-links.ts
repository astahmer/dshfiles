import { ChatFocusModel, type ChatFocus } from '@dshfiles/chat/chat-focus'
import * as Schema from 'effect/Schema'
import { TracesSchema } from './schema.js'
import type { AttributeValue } from './types.js'

const TRACES_VIEW_ID = 'dshfiles-traces'
const FOCUS_PREFIX = 'dshfiles-traces-focus:'

const tracesFocusSchema = Schema.Struct({ turn: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })

/** What the Traces tab opens for a Conversation View request: the trace of one of the thread's turns. */
export type TracesFocus = Schema.Schema.Type<typeof tracesFocusSchema>

const encodeFocus = (focus: TracesFocus): string => `${FOCUS_PREFIX}${JSON.stringify(TracesSchema.decode(tracesFocusSchema, focus))}`

const decodeFocus = (value: string): TracesFocus | null => {
  if (!value.startsWith(FOCUS_PREFIX)) return null
  try {
    const parsed = Schema.decodeUnknownResult(tracesFocusSchema)(JSON.parse(value.slice(FOCUS_PREFIX.length)))
    return parsed._tag === 'Success' ? parsed.success : null
  } catch {
    return null
  }
}

interface LinkableSpan {
  readonly spanId: string
  readonly parentSpanId: string | null
  readonly sessionId: string | null
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

export interface ThreadTarget {
  readonly sessionId: string
  /** Where Chat should land; null when no span on the way up carries a turn. */
  readonly focus: ChatFocus | null
}

const identifierSchema = Schema.String.check(Schema.isMinLength(1))
const counterSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** The thread and Chat focus attributes one span carries, decoded from its stored attribute values. */
const linkAttributesOf = (span: LinkableSpan) => {
  const sessionAttribute = Schema.decodeUnknownResult(identifierSchema)(span.attributes['dsh.session.id'])
  const turn = Schema.decodeUnknownResult(counterSchema)(span.attributes['dsh.turn'])
  const step = Schema.decodeUnknownResult(counterSchema)(span.attributes['dsh.step'])
  const toolCallId = Schema.decodeUnknownResult(identifierSchema)(span.attributes['gen_ai.tool.call.id'])
  return {
    sessionId: sessionAttribute._tag === 'Success' ? sessionAttribute.success : (span.sessionId ?? undefined),
    turn: turn._tag === 'Success' ? turn.success : undefined,
    step: step._tag === 'Success' ? step.success : undefined,
    toolCallId: toolCallId._tag === 'Success' ? toolCallId.success : undefined,
  }
}

/**
 * The thread and Chat focus of one span: the nearest span at or above it that carries `dsh.turn` (agent telemetry's
 * turn, step, model and tool spans) names the turn, its `dsh.step` the step and, on a tool span, `gen_ai.tool.call.id`
 * the tool call. A plugin span nested under a tool call therefore lands on that tool call. Without a turn anywhere up
 * the tree, the span's own Session is opened with no focus.
 */
const targetOf = (spans: readonly LinkableSpan[], spanId: string): ThreadTarget | null => {
  const byId = new Map(spans.map(span => [span.spanId, span]))
  const start = byId.get(spanId)
  const fallbackSession = start === undefined ? undefined : linkAttributesOf(start).sessionId
  const seen = new Set<string>()
  for (let span = start; span !== undefined && !seen.has(span.spanId); span = span.parentSpanId === null ? undefined : byId.get(span.parentSpanId)) {
    seen.add(span.spanId)
    const link = linkAttributesOf(span)
    if (link.turn === undefined || link.sessionId === undefined) continue
    const focus = ChatFocusModel.schema.safeParse({ turn: link.turn, step: link.step, toolCallId: link.toolCallId })
    return { sessionId: link.sessionId, focus: focus.success ? focus.data : null }
  }
  return fallbackSession === undefined ? null : { sessionId: fallbackSession, focus: null }
}

export class ThreadLinks {
  /** The `conversation.view` entry id of a thread's Traces tab. */
  static readonly viewId = TRACES_VIEW_ID
  static readonly encodeFocus = encodeFocus
  static readonly decodeFocus = decodeFocus
  static readonly targetOf = targetOf
}
