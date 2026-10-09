import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'

export interface CredentialSetupPort {
  describe(ref: string): Promise<CredentialInfo>
  set(ref: string, value: string): Promise<void>
}
