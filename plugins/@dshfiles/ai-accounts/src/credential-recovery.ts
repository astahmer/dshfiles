import type { LlmFailure } from '@deepseek-ai/dsh-llm'

const CREDENTIAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  'AUTH',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'ACCOUNT_SIGNED_OUT',
  'ACCOUNT_SIGN_IN_REQUIRED',
])

export const isCredentialRecoveryFailure = (failure: Pick<LlmFailure, 'code' | 'status'>): boolean =>
  CREDENTIAL_FAILURE_CODES.has(failure.code) || failure.status === 401 || failure.status === 403
