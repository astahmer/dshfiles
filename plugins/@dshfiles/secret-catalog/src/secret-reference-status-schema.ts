import { secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Schema } from 'effect'

const secretReferenceStateSchema = Schema.Literals([
  'resolved',
  'empty',
  'invalid-reference',
  'alias-missing',
  'environment-missing',
  'ambiguous',
  'value-unreadable',
  'value-empty',
  'cli-missing',
  'cli-timeout',
  'cli-failed',
])
export type SecretReferenceState = typeof secretReferenceStateSchema.Type

/** A same-named alias in a project or machine-local config, which a global-only resolver cannot reach. */
const secretReferenceElsewhereSchema = Schema.Struct({
  scope: secretScopeSchemaEffect,
  folder: Schema.String.check(Schema.isMaxLength(4096)),
  environment: Schema.String.check(Schema.isMaxLength(256)),
})
export type SecretReferenceElsewhere = typeof secretReferenceElsewhereSchema.Type

/** Where `secret --global` writes, and the file it really lands in when that path is a symlink (e.g. Nix-managed). */
const secretGlobalConfigSchema = Schema.Struct({
  path: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  linkedTo: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
})
export type SecretGlobalConfig = typeof secretGlobalConfigSchema.Type

export const secretReferenceStatusSchema = Schema.Struct({
  state: secretReferenceStateSchema,
  reference: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  alias: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  environment: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  cwd: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  scope: Schema.NullOr(secretScopeSchemaEffect),
  environments: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(64)),
  scopes: Schema.Array(Schema.String.check(Schema.isMaxLength(64))).check(Schema.isMaxLength(16)),
  elsewhere: Schema.Array(secretReferenceElsewhereSchema).check(Schema.isMaxLength(64)),
  writeScope: secretScopeSchemaEffect,
  globalConfig: secretGlobalConfigSchema,
})
export type SecretReferenceStatus = typeof secretReferenceStatusSchema.Type
