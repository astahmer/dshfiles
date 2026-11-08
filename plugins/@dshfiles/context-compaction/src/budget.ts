/**
 * The safe byte budget for one summary request.
 *
 * A route's context window is counted in tokens while every request the engine builds is measured in JSON bytes, and
 * the request always carries the conversation's own system prompt and tool catalog: this session's 365 tools alone
 * serialize to 204 KB. So the budget is the window's room after the completion and the safety reserve, converted with a
 * conservative bytes-per-token ratio — JSON tool schemas tokenize worse than prose, and an under-estimate only costs a
 * split request while an over-estimate fails at the provider.
 *
 * A route that declares no window falls back to the conservative default; if the fixed prefix does not fit that
 * fallback the request is refused rather than sent oversized.
 */
export const FALLBACK_CONTEXT_WINDOW = 32_768
export const BYTES_PER_TOKEN = 3
export const SAFETY_FRACTION = 0.85
export const MIN_CONTEXT_RESERVE_TOKENS = 4_096
export const SUMMARY_PROMPT_RESERVE_BYTES = 4_096
export const MIN_REQUEST_BUDGET_BYTES = 1_024
/** Memory bound on one request, not a capacity claim: no supported route window needs more. */
export const MAX_REQUEST_BUDGET_BYTES = 4_194_304

export const compactionRequestBudget = (input: { readonly contextWindow: number | undefined; readonly maxTokens: number }): number => {
  const contextWindow = input.contextWindow ?? FALLBACK_CONTEXT_WINDOW
  const reserve = Math.max(MIN_CONTEXT_RESERVE_TOKENS, Math.ceil(contextWindow * 0.05))
  const availableTokens = contextWindow - input.maxTokens - reserve
  if (availableTokens <= 0) return 0
  const availableBytes = Math.floor(availableTokens * BYTES_PER_TOKEN * SAFETY_FRACTION) - SUMMARY_PROMPT_RESERVE_BYTES
  return Math.max(0, Math.min(MAX_REQUEST_BUDGET_BYTES, availableBytes))
}
