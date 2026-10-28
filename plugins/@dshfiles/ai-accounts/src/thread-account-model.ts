import type { ThreadAccountPreview } from './thread-account-api.js'

type Selection = ThreadAccountPreview['target']
interface OfferedModel {
  readonly id: string
  readonly name: string
}
interface ModelChoice {
  readonly model: OfferedModel
  readonly strategy: ThreadAccountPreview['strategy']
}

/** Target defaults come from the deployment selection, then adapter/account preference order; never another account's hidden model. */
export class ThreadAccountModel {
  static choose(input: {
    readonly current: Selection
    readonly provider: string
    readonly models: readonly OfferedModel[]
    readonly defaultModel?: string | undefined
  }): ModelChoice {
    const same = input.models.find(model => model.id === input.current.model)
    if (same !== undefined) return { model: same, strategy: 'same-model' }
    const fallback = input.models.find(model => model.id === input.defaultModel)
    if (fallback !== undefined) return { model: fallback, strategy: 'default-model' }
    const preferred = input.models[0]
    if (preferred === undefined) throw new Error('This account has no available models. Configure its models before using it for a thread.')
    return { model: preferred, strategy: 'preferred-model' }
  }

  static same(left: Selection, right: Selection): boolean {
    return left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
  }

  /** Product recommendation only, not native compaction eligibility, a billing estimate or a reason to block a switch. */
  static suggestCompaction(estimatedTokens: number, targetWindow: number | null): boolean {
    return (
      Number.isFinite(estimatedTokens) &&
      (estimatedTokens >= 32_000 || (estimatedTokens >= 16_000 && targetWindow !== null && estimatedTokens >= targetWindow / 2))
    )
  }
}
