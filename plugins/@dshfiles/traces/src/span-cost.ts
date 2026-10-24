/**
 * SQL over the list-price cost agent telemetry puts on spans (`dshx.cost.usd`, priced from AI Accounts' models.dev
 * catalog when the call ran). Only model-call spans are summed: the turn span repeats its calls' total.
 */
const COST_ATTRIBUTE = 'dshx.cost.usd'

/** One JSON attribute of the span aliased `s`. */
const attribute = (key: string): string => `json_extract(s.attributes, '$."${key}"')`

const operation = attribute('gen_ai.operation.name')

const isModelCall = `(${operation} IN ('chat', 'text_completion', 'generate_content') OR (${operation} IS NULL AND s.name LIKE 'chat %'))`

export class SpanCost {
  static readonly attributeKey = COST_ATTRIBUTE
  static readonly attribute = attribute
  static readonly isModelCall = isModelCall
  /** The span's cost when it is a model call, else NULL, so `SUM` never counts a turn total twice. */
  static readonly modelCallCost = `CASE WHEN ${isModelCall} THEN ${attribute(COST_ATTRIBUTE)} END`
}
