import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { aliasSchema, createMetadataSchema, environmentSchema, updateMetadataSchema } from './secret-arguments.js'
import { parseSecretPrintMetadata, type SecretMetadata } from './secret-metadata.js'

export type SecretScope = 'global' | 'project' | 'local'

export interface SecretCliRequest {
  readonly args: readonly string[]
  readonly cwd: string | null
  readonly captureStdout: boolean
  readonly stdin?: string
}

export type SecretCliRunner = (request: SecretCliRequest) => Promise<string>

const validateCwd = (cwd: string | null): string | null => {
  if (cwd !== null && (!isAbsolute(cwd) || resolve(cwd) !== cwd)) throw new Error('A canonical absolute folder path is required.')
  return cwd
}

const requireFolder = (cwd: string | null): string => {
  const folder = validateCwd(cwd)
  if (folder === null) throw new Error('Choose a project folder for this alias scope.')
  return folder
}

const withoutTerminalNewline = (value: string): string => {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

export interface SecretCatalogOperations {
  readonly list: (cwd: string | null) => Promise<readonly SecretMetadata[]>
  readonly reveal: (alias: string, scope: SecretScope, cwd: string | null, environment?: string) => Promise<string>
  readonly copy: (alias: string, scope: SecretScope, cwd: string | null, environment?: string) => Promise<{ readonly copied: true }>
  readonly create: (input: SecretCreateInput) => Promise<{ readonly created: true }>
  readonly update: (input: SecretUpdateInput) => Promise<{ readonly updated: true }>
  readonly removeAlias: (alias: string, scope: SecretScope, cwd: string | null) => Promise<{ readonly removed: true }>
  readonly deleteItem: (alias: string, scope: SecretScope, cwd: string | null, environment: string) => Promise<{ readonly deleted: true }>
}

export interface SecretCreateInput {
  readonly alias: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly environment: string
  readonly valueMode: 'generate' | 'manual'
  readonly value: string | null
  readonly name?: string
  readonly source?: string
  readonly tags?: string
  readonly type?: string
  readonly field?: string
}

export interface SecretUpdateInput {
  readonly alias: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly value: string | null
  readonly environment: string
  readonly name?: string
  readonly source?: string
  readonly tags?: string
}

const flagArguments = (metadata: Readonly<Record<string, string | undefined>>): string[] =>
  Object.entries(metadata).flatMap(([flag, value]) => (value === undefined ? [] : [`--${flag}`, value]))

const createMetadataArguments = (input: Pick<SecretCreateInput, 'name' | 'source' | 'tags' | 'type' | 'field'>): string[] =>
  flagArguments(createMetadataSchema.parse({ name: input.name, source: input.source, tags: input.tags, type: input.type, field: input.field }))

const updateMetadataArguments = (input: Pick<SecretUpdateInput, 'name' | 'source' | 'tags'>): string[] =>
  flagArguments(updateMetadataSchema.parse({ name: input.name, source: input.source, tags: input.tags }))

const scopeArguments = (scope: SecretScope, cwd: string | null): string[] => {
  if (scope === 'global') return ['--global']
  if (scope === 'local') return ['--config', join(requireFolder(cwd), '.secret.local.json')]
  return []
}

const exactConfigArguments = (scope: SecretScope, cwd: string | null): string[] => {
  if (scope === 'global') return ['--config', join(homedir(), '.config', 'secret', 'config.json')]
  if (scope === 'local') return ['--config', join(requireFolder(cwd), '.secret.local.json')]
  return []
}

const metadataEditArguments = (scope: SecretScope, cwd: string | null): string[] => {
  return exactConfigArguments(scope, cwd)
}

const environmentArguments = (environment: string): string[] => ['--env', environmentSchema.parse(environment)]

export const createSecretCatalogOperations = (run: SecretCliRunner): SecretCatalogOperations => {
  const validatedAlias = (inputAlias: string): string => aliasSchema.parse(inputAlias)
  const list = async (cwd: string | null): Promise<readonly SecretMetadata[]> => {
    const canonicalCwd = validateCwd(cwd)
    const args = canonicalCwd === null ? ['print', 'global', '--json'] : ['print', '--all', '--json']
    const stdout = await run({ args, cwd: canonicalCwd, captureStdout: true })
    return parseSecretPrintMetadata(stdout, canonicalCwd === null ? 'global' : 'unknown')
  }

  const getArguments = (alias: string, scope: SecretScope, cwd: string | null, environment?: string): string[] => {
    const args = ['get', alias]
    if (environment !== undefined && environment.length > 0) args.push(...environmentArguments(environment))
    args.push(...exactConfigArguments(scope, cwd))
    return args
  }

  return {
    list,
    reveal: async (inputAlias, scope, cwd, environment) => {
      const alias = validatedAlias(inputAlias)
      const stdout = await run({ args: getArguments(alias, scope, cwd, environment), cwd: validateCwd(cwd), captureStdout: true })
      return withoutTerminalNewline(stdout)
    },
    copy: async (inputAlias, scope, cwd, environment) => {
      const alias = validatedAlias(inputAlias)
      await run({ args: [...getArguments(alias, scope, cwd, environment), '--copy'], cwd: validateCwd(cwd), captureStdout: false })
      return { copied: true }
    },
    create: async input => {
      const alias = validatedAlias(input.alias)
      const environment = environmentSchema.parse(input.environment)
      const cwd = input.scope === 'global' ? validateCwd(input.cwd) : requireFolder(input.cwd)
      if (input.valueMode === 'manual' && (input.value === null || input.value.length === 0))
        throw new Error('A non-empty value is required for a manual secret.')
      if (input.valueMode === 'generate' && input.value !== null) throw new Error('Generated secrets cannot include a submitted value.')
      const existingRows = await list(cwd)
      if (existingRows.some(row => row.alias === alias && row.environment === environment)) {
        throw new Error('An alias with this name already exists in the current environment.')
      }
      const args = ['set', alias, ...environmentArguments(environment), ...createMetadataArguments(input), ...scopeArguments(input.scope, cwd)]
      if (input.valueMode === 'generate') args.push('--generate')
      await run({
        args,
        cwd,
        captureStdout: false,
        ...(input.valueMode === 'manual' && input.value !== null ? { stdin: input.value } : {}),
      })
      return { created: true }
    },
    update: async input => {
      const alias = validatedAlias(input.alias)
      const cwd = input.scope === 'global' ? validateCwd(input.cwd) : requireFolder(input.cwd)
      const metadata = updateMetadataArguments(input)
      if (metadata.length > 0) {
        await run({
          args: ['edit', alias, ...metadata, ...environmentArguments(input.environment), ...metadataEditArguments(input.scope, cwd)],
          cwd,
          captureStdout: false,
        })
      }
      if (input.value !== null) {
        await run({
          args: ['set', alias, '--force', ...environmentArguments(input.environment), ...scopeArguments(input.scope, cwd)],
          cwd,
          captureStdout: false,
          stdin: input.value,
        })
      }
      if (metadata.length === 0 && input.value === null) throw new Error('No secret changes were provided.')
      return { updated: true }
    },
    removeAlias: async (inputAlias, scope, cwd) => {
      const alias = validatedAlias(inputAlias)
      const canonicalCwd = scope === 'global' ? validateCwd(cwd) : requireFolder(cwd)
      await run({
        args: ['unset', alias, ...scopeArguments(scope, canonicalCwd)],
        cwd: canonicalCwd,
        captureStdout: false,
      })
      return { removed: true }
    },
    deleteItem: async (inputAlias, scope, cwd, environment) => {
      const alias = validatedAlias(inputAlias)
      const canonicalCwd = scope === 'global' ? validateCwd(cwd) : requireFolder(cwd)
      await run({
        args: ['rm', alias, '--force', ...environmentArguments(environment), ...exactConfigArguments(scope, canonicalCwd)],
        cwd: canonicalCwd,
        captureStdout: false,
      })
      return { deleted: true }
    },
  }
}
