import { DEFAULT_SECRET_ENVIRONMENT, formatSecretReference } from '@dshfiles/credential-port'
import type { SecretReference } from '@dshfiles/credential-port'
import { secretAliasSchemaEffect, secretEnvironmentSchemaEffect, secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Schema } from 'effect'
import type { SecretMetadata } from './secret-metadata.js'
import type { SecretCreateInput } from './secret-operations.js'

const secretSetupValueLimit = 262_144

const secretSetupDraftFields = {
  alias: secretAliasSchemaEffect,
  environment: secretEnvironmentSchemaEffect,
  scope: secretScopeSchemaEffect,
  value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(secretSetupValueLimit)),
}
const secretSetupDraftEffectSchema = Schema.Struct(secretSetupDraftFields)

export type SecretSetupDraft = typeof secretSetupDraftEffectSchema.Type
export type SecretSetupIssue = 'alias' | 'environment' | 'value' | 'folder' | 'duplicate'

export class SecretSetupModel {
  static readonly draftSchema = Schema.toStandardSchemaV1(secretSetupDraftEffectSchema)
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
    const parsed = Schema.decodeUnknownResult(secretSetupDraftEffectSchema)(input.draft)
    if (parsed._tag === 'Failure') {
      if (!Schema.is(secretSetupDraftFields.alias)(input.draft.alias)) return 'alias'
      if (!Schema.is(secretSetupDraftFields.environment)(input.draft.environment)) return 'environment'
      return 'value'
    }
    if (input.draft.scope !== 'global' && input.cwd === null) return 'folder'
    if (input.rows.some(row => row.alias === input.draft.alias && row.environment === input.draft.environment)) return 'duplicate'
    return null
  }

  static createInput(input: { readonly draft: SecretSetupDraft; readonly cwd: string | null }): SecretCreateInput {
    const draft = Schema.decodeUnknownSync(secretSetupDraftEffectSchema)(input.draft)
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

  static existingReference(input: { readonly alias: string; readonly environment: string; readonly rows: readonly SecretMetadata[] }): string | null {
    const matchingRows = input.rows.filter(row => row.alias === input.alias && row.environment === input.environment)
    if (matchingRows.length !== 1) return null
    const matchingRow = matchingRows[0]
    if (matchingRow === undefined) return null
    if (!SecretSetupModel.uniquelyBindableSecrets(input.rows).some(row => row.id === matchingRow.id)) return null
    return SecretSetupModel.reference({ alias: matchingRow.alias, environment: matchingRow.environment })
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
