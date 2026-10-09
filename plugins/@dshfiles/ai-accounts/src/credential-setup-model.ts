import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import { isKeyEnvName } from './api.js'

export interface CredentialSetupVisibilityInput {
  readonly setupAvailable: boolean
  readonly draftInstanceId: string
  readonly selectedInstanceId: string | undefined
  readonly selectedSignedIn: boolean | undefined
  readonly apiKeyEnv: string
  readonly credentialInfo: CredentialInfo | null | undefined
}

export const shouldOfferCredentialSetup = (input: CredentialSetupVisibilityInput): boolean =>
  input.setupAvailable &&
  input.selectedInstanceId === input.draftInstanceId &&
  input.selectedSignedIn === false &&
  isKeyEnvName(input.apiKeyEnv) &&
  input.credentialInfo?.configured === false &&
  input.credentialInfo.writable
