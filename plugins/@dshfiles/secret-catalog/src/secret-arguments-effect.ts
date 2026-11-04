import { Schema } from 'effect'
import { secretAliasSchemaEffect, secretEnvironmentSchemaEffect, secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'

const freeTextSchema = (maxLength: number) =>
  Schema.String.check(
    Schema.isMaxLength(maxLength),
    Schema.makeFilter(value => (value.startsWith('-') ? 'A value cannot start with "-".' : undefined)),
  )

export const secretAliasSchemaEffectForCatalog = secretAliasSchemaEffect
export const secretEnvironmentSchemaEffectForCatalog = secretEnvironmentSchemaEffect
export const secretScopeSchemaEffectForCatalog = secretScopeSchemaEffect

export const createMetadataFields = {
  name: freeTextSchema(512).pipe(Schema.optionalKey),
  source: freeTextSchema(2048).pipe(Schema.optionalKey),
  tags: freeTextSchema(1024).pipe(Schema.optionalKey),
  type: freeTextSchema(64).pipe(Schema.optionalKey),
  field: freeTextSchema(256).pipe(Schema.optionalKey),
}

export const updateMetadataFields = {
  name: freeTextSchema(512).pipe(Schema.optionalKey),
  source: freeTextSchema(2048).pipe(Schema.optionalKey),
  tags: freeTextSchema(1024).pipe(Schema.optionalKey),
}

export const createMetadataSchemaEffect = Schema.Struct(createMetadataFields)

export const updateMetadataSchemaEffect = Schema.Struct(updateMetadataFields)
