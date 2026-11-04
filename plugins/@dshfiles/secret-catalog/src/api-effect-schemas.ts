import { secretAliasSchemaEffect, secretEnvironmentSchemaEffect, secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Schema } from 'effect'
import { createMetadataFields, updateMetadataFields } from './secret-arguments-effect.js'
import { secretMetadataSchema } from './secret-metadata.js'

/** The Secret Catalog API contracts; dshx publishes them as closed, strictly decoded schemas. */

const cwdSchema = Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096)))

export const listInputSchema = Schema.Struct({ cwd: cwdSchema })

export const listOutputSchema = Schema.Array(secretMetadataSchema).check(Schema.isMaxLength(5000))

export const createInputSchema = Schema.Struct({
  alias: secretAliasSchemaEffect,
  cwd: cwdSchema,
  scope: secretScopeSchemaEffect,
  environment: secretEnvironmentSchemaEffect,
  valueMode: Schema.Literals(['generate', 'manual']),
  value: Schema.NullOr(Schema.String.check(Schema.isMaxLength(262_144))),
  ...createMetadataFields,
}).check(
  Schema.makeFilter(input =>
    input.valueMode === 'generate'
      ? input.value === null
        ? undefined
        : 'A manual value is required only for manual creation.'
      : input.value !== null && input.value.length > 0
        ? undefined
        : 'A manual value is required only for manual creation.',
  ),
)

export const revealInputSchema = Schema.Struct({
  alias: secretAliasSchemaEffect,
  cwd: cwdSchema,
  scope: secretScopeSchemaEffect,
  environment: Schema.optionalKey(secretEnvironmentSchemaEffect),
})

export const updateInputSchema = Schema.Struct({
  alias: secretAliasSchemaEffect,
  cwd: cwdSchema,
  scope: secretScopeSchemaEffect,
  value: Schema.NullOr(Schema.String.check(Schema.isMaxLength(262_144))),
  environment: secretEnvironmentSchemaEffect,
  newAlias: Schema.optionalKey(secretAliasSchemaEffect),
  ...updateMetadataFields,
})

export const removeAliasInputSchema = Schema.Struct({ alias: secretAliasSchemaEffect, cwd: cwdSchema, scope: secretScopeSchemaEffect })

export const deleteItemInputSchema = Schema.Struct({
  alias: secretAliasSchemaEffect,
  cwd: cwdSchema,
  scope: secretScopeSchemaEffect,
  environment: secretEnvironmentSchemaEffect,
})

export const machineOutputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(256)),
  name: Schema.String.check(Schema.isMaxLength(256)),
})

export const referenceStatusInputSchema = Schema.Struct({
  reference: Schema.String.check(Schema.isMaxLength(4096)).annotate({
    description: 'The stored reference text, e.g. secret:ALIAS or secret:ALIAS@env.',
  }),
  cwd: cwdSchema.annotate({
    description: 'Folder whose project and machine-local aliases also count; null checks global aliases only, as settings resolve.',
  }),
  probeFolders: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMaxLength(4096)))
      .check(Schema.isMaxLength(16))
      .annotate({ description: 'Project folders to search when the alias is missing, so the answer can say it exists only there.' }),
  ),
})
