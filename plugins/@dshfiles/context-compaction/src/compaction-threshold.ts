import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic'

type PolicyConfig = Pick<ResolvedConfig, 'thresholdRatio' | 'headroomTokens' | 'retainRatio' | 'retainTokens' | 'modelPolicies'>

interface CompactionSpecInput {
  readonly config: PolicyConfig
  readonly route: { readonly provider: string; readonly model: string }
  readonly contextWindow: number
  readonly reservedCompletionTokens: number
}

export interface CompactionSpec {
  readonly thresholdTokens: number
  readonly retainTokens: number
  /** False when the configured headroom left no pressure budget and was ignored. */
  readonly headroomApplied: boolean
}

/**
 * The automatic-compaction trigger and retained tail for one routed request, computed the way the stock engine's
 * `resolveTargetPolicy` + `resolveCompactSpec` compute them (neither is exported), with one deliberate difference: a
 * headroom buffer that leaves the model no pressure budget is ignored instead of disabling proactive compaction for
 * that route. Returns null when the output reservation alone fills the window, or when the retained tail is at least
 * as large as the trigger.
 */
export const compactionSpec = (input: CompactionSpecInput): CompactionSpec | null => {
  const override = input.config.modelPolicies.find(policy => policy.provider === input.route.provider && policy.model === input.route.model)
  const thresholdRatio = override?.thresholdRatio ?? input.config.thresholdRatio
  const headroomTokens = override?.headroomTokens ?? input.config.headroomTokens
  const messageBudgetTokens = input.contextWindow - input.reservedCompletionTokens
  if (messageBudgetTokens <= 0) return null
  const headroomApplied = messageBudgetTokens - headroomTokens > 0
  const pressureBudgetTokens = headroomApplied ? messageBudgetTokens - headroomTokens : messageBudgetTokens
  const thresholdTokens = Math.floor(Math.min(input.contextWindow * thresholdRatio, pressureBudgetTokens))
  const retainTokens =
    override?.retainTokens ??
    (override?.retainRatio === undefined ? input.config.retainTokens : undefined) ??
    Math.floor(messageBudgetTokens * (override?.retainRatio ?? input.config.retainRatio ?? 0))
  return retainTokens >= thresholdTokens ? null : { thresholdTokens, retainTokens, headroomApplied }
}

export const compactionThresholdTokens = (input: CompactionSpecInput): number | null => compactionSpec(input)?.thresholdTokens ?? null
