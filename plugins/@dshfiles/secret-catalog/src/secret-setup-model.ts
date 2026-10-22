import { DEFAULT_SECRET_ENVIRONMENT, formatSecretReference, secretAliasSchema, secretEnvironmentSchema, secretScopeSchema } from '@dshfiles/credential-port'
import type { SecretReference } from '@dshfiles/credential-port'
import { z } from 'zod'
import type { SecretMetadata } from './secret-metadata.js'
import type { SecretCreateInput } from './secret-operations.js'

const secretSetupValueLimit = 262_144
const secretSetupDraftSchema = z.object({
  alias: secretAliasSchema,
  environment: secretEnvironmentSchema,
  scope: secretScopeSchema,
  value: z.string().min(1).max(secretSetupValueLimit),
})

export type SecretSetupDraft = z.infer<typeof secretSetupDraftSchema>
export type SecretSetupIssue = 'alias' | 'environment' | 'value' | 'folder' | 'duplicate'

export class SecretSetupModel {
  static readonly draftSchema = secretSetupDraftSchema
  static readonly valueLimit = secretSetupValueLimit

  static draftDefaults(input: {
    readonly suggestedAlias?: string
    readonly environment?: string
    readonly scope?: SecretSetupDraft['scope']
  }): SecretSetupDraft {
    return {
      alias: input.suggestedAlias ?? '',
      environment: input.environment ?? DEFAULT_SECRET_ENVIRONMENT,
      scope: input.scope ?? 'global',
      value: '',
    }
  }

  static issue(input: { readonly draft: SecretSetupDraft; readonly cwd: string | null; readonly rows: readonly SecretMetadata[] }): SecretSetupIssue | null {
    const parsed = SecretSetupModel.draftSchema.safeParse(input.draft)
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0]
      if (path === 'alias') return 'alias'
      if (path === 'environment') return 'environment'
      return 'value'
    }
    if (input.draft.scope !== 'global' && input.cwd === null) return 'folder'
    if (input.rows.some(row => row.alias === input.draft.alias && row.environment === input.draft.environment)) return 'duplicate'
    return null
  }

  static createInput(input: { readonly draft: SecretSetupDraft; readonly cwd: string | null }): SecretCreateInput {
    const draft = SecretSetupModel.draftSchema.parse(input.draft)
    if (draft.scope !== 'global' && input.cwd === null) throw new Error('Choose a project folder before using this scope.')
    return {
      alias: draft.alias,
      cwd: input.cwd,
      scope: draft.scope,
      environment: draft.environment,
      valueMode: 'manual',
      value: draft.value,
    }
  }

  static reference(input: Pick<SecretReference, 'alias' | 'environment'>): string {
    return formatSecretReference(input)
  }

  static uniquelyBindableSecrets(rows: readonly SecretMetadata[]): readonly SecretMetadata[] {
    const matches = new Map<string, number>()
    for (const row of rows) {
      const key = JSON.stringify([row.alias, row.environment])
      matches.set(key, (matches.get(key) ?? 0) + 1)
    }
    return rows.filter(row => matches.get(JSON.stringify([row.alias, row.environment])) === 1)
  }
}
