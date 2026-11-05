import type { TraceTone } from '@dshfiles/plugin-ui/components/motion/trace-kit'
import type { TraceSpan, TraceSpanKind } from '@dshfiles/plugin-ui/components/motion/trace-waterfall'
import { TraceFormat } from './format.js'
import type { AttributeValue, SpanRow } from './types.js'

type Attributes = Readonly<Record<string, AttributeValue>>

const SERVICE_TONES: readonly TraceTone[] = ['info', 'violet', 'teal', 'warning', 'success', 'primary']

/** A stable kit tone per service name, so one service keeps its bar colour across traces. */
const serviceTone = (service: string): TraceTone => {
  let hash = 0
  for (const character of service) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return SERVICE_TONES[hash % SERVICE_TONES.length] ?? 'info'
}

const MODEL_OPERATIONS = new Set(['chat', 'text_completion', 'generate_content'])
const AGENT_OPERATIONS = new Set(['invoke_agent', 'create_agent'])

/** The GenAI semantic-convention operation of a span, as the waterfall kind its totals count. */
const kindOf = (attributes: Attributes): TraceSpanKind => {
  const operation = attributes['gen_ai.operation.name']
  if (typeof operation !== 'string') return 'span'
  if (MODEL_OPERATIONS.has(operation)) return 'model'
  if (operation === 'execute_tool') return 'tool'
  if (AGENT_OPERATIONS.has(operation)) return 'agent'
  return 'span'
}

const numberAt = (attributes: Attributes, key: string): number => {
  const value = attributes[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** gen_ai.usage input plus output tokens; undefined when the span reports none. */
const tokensOf = (attributes: Attributes): number | undefined => {
  const total = numberAt(attributes, 'gen_ai.usage.input_tokens') + numberAt(attributes, 'gen_ai.usage.output_tokens')
  return total > 0 ? total : undefined
}

/**
 * Stored span rows (milliseconds from the trace start) as kit waterfall spans (seconds). The parent comes from the
 * Host's depth-first order, not `parentSpanId`, so orphans and parent cycles the Host listed flat stay visible roots.
 */
const fromRows = (rows: readonly SpanRow[]): readonly TraceSpan[] => {
  const ancestors: string[] = []
  return rows.map(row => {
    ancestors.length = row.depth
    const parentId = ancestors.at(-1)
    ancestors.push(row.spanId)
    const tone = serviceTone(row.service)
    return {
      id: row.spanId,
      parentId,
      name: row.name,
      detail: row.service,
      kind: kindOf(row.attributes),
      glyph: { letter: row.service, tone },
      tone,
      start: row.offsetMs / 1000,
      end: (row.offsetMs + row.durationMs) / 1000,
      cost: TraceFormat.spanCostUsd(row.attributes) ?? undefined,
      tokens: tokensOf(row.attributes),
      error: row.status === 'error' ? (row.statusMessage ?? row.status) : undefined,
    }
  })
}

export const WaterfallSpans = { fromRows, kindOf, tokensOf, serviceTone } as const
