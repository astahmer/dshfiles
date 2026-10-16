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

const credentialForStorage = (credential: OAuthCredential): OAuthCredential => {
  const parsed = credentialSchema.parse(credential)
  const entries = Object.entries(parsed).filter(([, value]) => value !== undefined)
  return credentialSchema.parse(Object.fromEntries(entries))
}

type CopilotCredentialProvider = Partial<Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>>

export class CopilotCredentialModel {
  static readonly key = (instanceId: string) => credentialKey('ai-accounts', `github-copilot-${Buffer.from(instanceId, 'utf8').toString('hex')}`)
}

export const createCopilotCredentialsService = (provider: CopilotCredentialProvider | undefined) => ({
  read: async (instanceId: string): Promise<OAuthCredential | undefined> => {
    if (provider?.readRecord === undefined) return undefined
    const record = await provider.readRecord(CopilotCredentialModel.key(instanceId))
    if (record?.kind !== 'grant') return undefined
    const parsed = credentialSchema.safeParse(record.payload)
    return parsed.success ? parsed.data : undefined
  },

  modify: async (input: {
    readonly instanceId: string
    readonly mutate: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>
  }): Promise<OAuthCredential | undefined> => {
    if (provider?.modifyRecord === undefined) throw new Error('DSH credential records are unavailable.')
    const result = await provider.modifyRecord(CopilotCredentialModel.key(input.instanceId), async current => {
      const parsed = current?.kind === 'grant' ? credentialSchema.safeParse(current.payload) : undefined
      const next = await input.mutate(parsed?.success ? parsed.data : undefined)
      return next === undefined ? undefined : { kind: 'grant', payload: credentialForStorage(next) }
    })
    if (result?.kind !== 'grant') return undefined
    const parsed = credentialSchema.safeParse(result.payload)
    return parsed.success ? parsed.data : undefined
  },

  remove: async (instanceId: string): Promise<void> => {
    if (provider?.deleteRecord === undefined) throw new Error('DSH credential records are unavailable.')
    await provider.deleteRecord(CopilotCredentialModel.key(instanceId))
  },
})
