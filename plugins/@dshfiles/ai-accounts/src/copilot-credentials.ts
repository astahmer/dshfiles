import { Buffer } from 'node:buffer'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import type { OAuthCredential } from '@earendil-works/pi-ai'

const credentialSchema = z
  .object({
    type: z.literal('oauth'),
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.number(),
    availableModelIds: z.array(z.string()).optional(),
    enterpriseUrl: z.string().optional(),
  })
  .passthrough()

export const copilotCredentialKey = (instanceId: string) => credentialKey('ai-accounts', `github-copilot-${Buffer.from(instanceId, 'utf8').toString('hex')}`)

export const readCopilotCredential = async (
  provider: Pick<CredentialProvider, 'readRecord'> | undefined,
  instanceId: string,
): Promise<OAuthCredential | undefined> => {
  if (provider === undefined) return undefined
  const record = await provider.readRecord(copilotCredentialKey(instanceId))
  if (record?.kind !== 'grant') return undefined
  const parsed = credentialSchema.safeParse(record.payload)
  return parsed.success ? parsed.data : undefined
}

export const modifyCopilotCredential = async (
  provider: Pick<CredentialProvider, 'modifyRecord'> | undefined,
  instanceId: string,
  mutate: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>,
): Promise<OAuthCredential | undefined> => {
  if (provider === undefined) throw new Error('DSH credential records are unavailable.')
  const result = await provider.modifyRecord(copilotCredentialKey(instanceId), async current => {
    const parsed = current?.kind === 'grant' ? credentialSchema.safeParse(current.payload) : undefined
    const next = await mutate(parsed?.success ? parsed.data : undefined)
    return next === undefined ? undefined : { kind: 'grant', payload: next }
  })
  if (result?.kind !== 'grant') return undefined
  const parsed = credentialSchema.safeParse(result.payload)
  return parsed.success ? parsed.data : undefined
}

export const deleteCopilotCredential = async (provider: Pick<CredentialProvider, 'deleteRecord'> | undefined, instanceId: string): Promise<void> => {
  if (provider === undefined) throw new Error('DSH credential records are unavailable.')
  await provider.deleteRecord(copilotCredentialKey(instanceId))
}
