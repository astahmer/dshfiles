import type { AccountKind } from './api.js'

export interface CredentialSetupVisibilityInput {
  readonly setupAvailable: boolean
  readonly draftInstanceId: string
  readonly selectedInstanceId: string | undefined
  readonly accountKind: AccountKind
}

export const shouldOfferCredentialSetup = (input: CredentialSetupVisibilityInput): boolean =>
  input.setupAvailable && input.selectedInstanceId === input.draftInstanceId && input.accountKind !== 'codex'
