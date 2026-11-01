import { Buffer } from 'node:buffer'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import * as Schema from 'effect/Schema'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { AiAccountsSchema } from './effect-schema.js'

/**
 * The stored grant keeps the SDK's own fields plus whatever the login flow added (`dshLoginOwner`), so the record is a
 * struct with a free-form rest rather than a closed shape.
 */
const credentialSchema = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.Literal('oauth'),
    access: Schema.String.check(Schema.isMinLength(1)),
    refresh: Schema.String.check(Schema.isMinLength(1)),
    expires: Schema.Number.check(Schema.isFinite()),
    availableModelIds: Schema.optional(Schema.Array(Schema.String)),
    enterpriseUrl: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const credentialForStorage = (credential: OAuthCredential): OAuthCredential => {
  const parsed = AiAccountsSchema.decode(credentialSchema, credential)
  const entries = Object.entries(parsed).filter(([, value]) => value !== undefined)
  return AiAccountsSchema.decode(credentialSchema, Object.fromEntries(entries))
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
    const parsed = AiAccountsSchema.decodeResult(credentialSchema, record.payload)
    return parsed._tag === 'Success' ? parsed.success : undefined
  },

  modify: async (input: {
    readonly instanceId: string
    readonly mutate: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>
  }): Promise<OAuthCredential | undefined> => {
    if (provider?.modifyRecord === undefined) throw new Error('DSH credential records are unavailable.')
    const result = await provider.modifyRecord(CopilotCredentialModel.key(input.instanceId), async current => {
      const parsed = current?.kind === 'grant' ? AiAccountsSchema.decodeResult(credentialSchema, current.payload) : undefined
      const currentCredential = parsed === undefined || parsed._tag !== 'Success' ? undefined : parsed.success
      const next = await input.mutate(currentCredential)
      return next === undefined ? undefined : { kind: 'grant', payload: credentialForStorage(next) }
    })
    if (result?.kind !== 'grant') return undefined
    const parsed = AiAccountsSchema.decodeResult(credentialSchema, result.payload)
    return parsed._tag === 'Success' ? parsed.success : undefined
  },

  restoreOwned: async (instanceId: string, owner: string, previous: OAuthCredential | undefined): Promise<void> => {
    if (provider?.modifyRecord === undefined) return
    await provider.modifyRecord(CopilotCredentialModel.key(instanceId), async current => {
      const parsed = current?.kind === 'grant' ? AiAccountsSchema.decodeResult(credentialSchema, current.payload) : undefined
      if (parsed === undefined || parsed._tag !== 'Success' || parsed.success.dshLoginOwner !== owner) return undefined
      // Returning undefined means 'leave unchanged', not delete. A tombstone scrubs our own grant atomically.
      return { kind: 'grant', payload: previous ?? { retiredLoginOwner: owner } }
    })
  },

  remove: async (instanceId: string): Promise<void> => {
    if (provider?.deleteRecord === undefined) throw new Error('DSH credential records are unavailable.')
    await provider.deleteRecord(CopilotCredentialModel.key(instanceId))
  },
})
