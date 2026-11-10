import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic'

/**
 * The automatic-compaction trigger for one routed request, computed the way the stock engine's
 * `resolveTargetPolicy` + `resolveCompactSpec` compute it (neither is exported). Returns null where the engine
 * skips proactive compaction: a configuration that leaves no pressure budget, or a retained tail at least as large
 * as the trigger.
 */
export const compactionThresholdTokens = (input: {
  readonly config: Pick<ResolvedConfig, 'thresholdRatio' | 'headroomTokens' | 'retainRatio' | 'retainTokens' | 'modelPolicies'>
  readonly route: { readonly provider: string; readonly model: string }
  readonly contextWindow: number
  readonly reservedCompletionTokens: number
}): number | null => {
  const override = input.config.modelPolicies.find(policy => policy.provider === input.route.provider && policy.model === input.route.model)
  const thresholdRatio = override?.thresholdRatio ?? input.config.thresholdRatio
  const headroomTokens = override?.headroomTokens ?? input.config.headroomTokens
  const messageBudgetTokens = input.contextWindow - input.reservedCompletionTokens
  const pressureBudgetTokens = messageBudgetTokens - headroomTokens
  if (messageBudgetTokens <= 0 || pressureBudgetTokens <= 0) return null
  const thresholdTokens = Math.floor(Math.min(input.contextWindow * thresholdRatio, pressureBudgetTokens))
  const retainTokens =
    override?.retainTokens ??
    (override?.retainRatio === undefined ? input.config.retainTokens : undefined) ??
    Math.floor(messageBudgetTokens * (override?.retainRatio ?? input.config.retainRatio ?? 0))
  return retainTokens >= thresholdTokens ? null : thresholdTokens
}
