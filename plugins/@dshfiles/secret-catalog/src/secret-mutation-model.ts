import type { SecretRemoveTarget } from './secret-mutation-form.js'

export type RemovalDialogState = { readonly stage: 'choose' } | { readonly stage: 'confirm'; readonly target: SecretRemoveTarget }

const chooseRemovalTarget = (state: RemovalDialogState, target: SecretRemoveTarget): RemovalDialogState => {
  if (state.stage === 'confirm') return state
  return { stage: 'confirm', target }
}

const confirmedRemovalTarget = (state: RemovalDialogState): SecretRemoveTarget | null => {
  if (state.stage !== 'confirm') return null
  return state.target
}

export type ValueReplacementStage = 'editing' | 'confirming'

const requestValueReplacement = (stage: ValueReplacementStage): ValueReplacementStage => {
  if (stage === 'confirming') return 'editing'
  return 'confirming'
}

const maySubmitValueReplacement = (stage: ValueReplacementStage): boolean => stage === 'confirming'

export class SecretMutationRules {
  static readonly chooseRemovalTarget = chooseRemovalTarget
  static readonly confirmedRemovalTarget = confirmedRemovalTarget
  static readonly requestValueReplacement = requestValueReplacement
  static readonly maySubmitValueReplacement = maySubmitValueReplacement
}
