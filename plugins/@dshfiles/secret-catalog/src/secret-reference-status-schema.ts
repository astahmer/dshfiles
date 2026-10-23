import { secretScopeSchema } from '@dshfiles/credential-port'
import { z } from 'zod'

export const secretReferenceStateSchema = z.enum([
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
export type SecretReferenceState = z.infer<typeof secretReferenceStateSchema>

/** A same-named alias in a project or machine-local config, which a global-only resolver cannot reach. */
export const secretReferenceElsewhereSchema = z.object({
  scope: secretScopeSchema,
  folder: z.string().max(4096),
  environment: z.string().max(256),
})
export type SecretReferenceElsewhere = z.infer<typeof secretReferenceElsewhereSchema>

/** Where `secret --global` writes, and the file it really lands in when that path is a symlink (e.g. Nix-managed). */
export const secretGlobalConfigSchema = z.object({
  path: z.string().max(4096).nullable(),
  linkedTo: z.string().max(4096).nullable(),
})
export type SecretGlobalConfig = z.infer<typeof secretGlobalConfigSchema>

export const secretReferenceStatusSchema = z.object({
  state: secretReferenceStateSchema,
  reference: z.string().max(4096).nullable(),
  alias: z.string().max(256).nullable(),
  environment: z.string().max(256).nullable(),
  cwd: z.string().max(4096).nullable(),
  scope: secretScopeSchema.nullable(),
  environments: z.array(z.string().max(256)).max(64),
  scopes: z.array(z.string().max(64)).max(16),
  elsewhere: z.array(secretReferenceElsewhereSchema).max(64),
  writeScope: secretScopeSchema,
  globalConfig: secretGlobalConfigSchema,
})
export type SecretReferenceStatus = z.infer<typeof secretReferenceStatusSchema>
