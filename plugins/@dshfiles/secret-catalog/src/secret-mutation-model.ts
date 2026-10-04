import type { SecretRemoveTarget } from './secret-mutation-dialog.js'

export type RemovalDialogState = { readonly stage: 'choose' } | { readonly stage: 'confirm'; readonly target: SecretRemoveTarget }

export const chooseRemovalTarget = (state: RemovalDialogState, target: SecretRemoveTarget): RemovalDialogState => {
  if (state.stage === 'confirm') return state
  return { stage: 'confirm', target }
}

export const confirmedRemovalTarget = (state: RemovalDialogState): SecretRemoveTarget | null => {
  if (state.stage !== 'confirm') return null
  return state.target
}

export type ValueReplacementStage = 'editing' | 'confirming'

export const requestValueReplacement = (stage: ValueReplacementStage): ValueReplacementStage => {
  if (stage === 'confirming') return 'editing'
  return 'confirming'
}

export const maySubmitValueReplacement = (stage: ValueReplacementStage): boolean => stage === 'confirming'
