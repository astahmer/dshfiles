import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { Schema } from 'effect'
import {
  createMetadataSchemaEffect,
  secretAliasSchemaEffectForCatalog,
  secretEnvironmentSchemaEffectForCatalog,
  updateMetadataSchemaEffect,
} from './secret-arguments-effect.js'
import type { SecretScope } from '@dshfiles/credential-port'
import { parseSecretPrintMetadata, type SecretMetadata } from './secret-metadata.js'

export class SecretCatalogOperationError extends Schema.TaggedError<SecretCatalogOperationError>()('SecretCatalogOperationError', {
  message: Schema.String,
}) {}

export interface SecretCliRequest {
  readonly args: readonly string[]
  readonly cwd: string | null
  readonly captureStdout: boolean
  readonly stdin?: string
  readonly signal?: AbortSignal
}

export type SecretCliRunner = (request: SecretCliRequest) => Promise<string>

const validateCwd = (cwd: string | null): string | null => {
  if (cwd !== null && (!isAbsolute(cwd) || resolve(cwd) !== cwd))
    throw new SecretCatalogOperationError({ message: 'A canonical absolute folder path is required.' })
  return cwd
}

const requireFolder = (cwd: string | null): string => {
  const folder = validateCwd(cwd)
  if (folder === null) throw new SecretCatalogOperationError({ message: 'Choose a project folder for this alias scope.' })
  return folder
}

const withoutTerminalNewline = (value: string): string => {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

export interface SecretCatalogOperations {
  readonly list: (cwd: string | null) => Promise<readonly SecretMetadata[]>
  readonly reveal: (alias: string, scope: SecretScope, cwd: string | null, environment?: string, signal?: AbortSignal) => Promise<string>
  readonly copy: (alias: string, scope: SecretScope, cwd: string | null, environment?: string, signal?: AbortSignal) => Promise<{ readonly copied: true }>
  readonly create: (input: SecretCreateInput, signal?: AbortSignal) => Promise<{ readonly created: true }>
  readonly update: (input: SecretUpdateInput, signal?: AbortSignal) => Promise<{ readonly updated: true }>
  readonly removeAlias: (alias: string, scope: SecretScope, cwd: string | null, signal?: AbortSignal) => Promise<{ readonly removed: true }>
  readonly deleteItem: (alias: string, scope: SecretScope, cwd: string | null, environment: string, signal?: AbortSignal) => Promise<{ readonly deleted: true }>
}

export interface SecretCreateInput {
  readonly alias: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly environment: string
  readonly valueMode: 'generate' | 'manual'
  readonly value: string | null
  readonly name?: string | undefined
  readonly source?: string | undefined
  readonly tags?: string | undefined
  readonly type?: string | undefined
  readonly field?: string | undefined
}

export interface SecretUpdateInput {
  readonly alias: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly value: string | null
  readonly environment: string
  readonly newAlias?: string | undefined
  readonly name?: string | undefined
  readonly source?: string | undefined
  readonly tags?: string | undefined
}

const flagArguments = (metadata: Readonly<Record<string, string | undefined>>): string[] =>
  Object.entries(metadata).flatMap(([flag, value]) => (value === undefined ? [] : [`--${flag}`, value]))

const createMetadataArguments = (input: Pick<SecretCreateInput, 'name' | 'source' | 'tags' | 'type' | 'field'>): string[] =>
  flagArguments(
    Schema.decodeUnknownSync(createMetadataSchemaEffect)({ name: input.name, source: input.source, tags: input.tags, type: input.type, field: input.field }),
  )

const updateMetadataArguments = (input: Pick<SecretUpdateInput, 'name' | 'source' | 'tags'>): string[] =>
  flagArguments(Schema.decodeUnknownSync(updateMetadataSchemaEffect)({ name: input.name, source: input.source, tags: input.tags }))

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

const environmentArguments = (environment: string): string[] => ['--env', Schema.decodeUnknownSync(secretEnvironmentSchemaEffectForCatalog)(environment)]

const readOnlyCommands = new Set(['print', 'get'])

export const createSecretCatalogOperations = (runCli: SecretCliRunner): SecretCatalogOperations => {
  const validatedAlias = (inputAlias: string): string => Schema.decodeUnknownSync(secretAliasSchemaEffectForCatalog)(inputAlias)
  // Panel, picker, setup offer and reference checks list the same folder at once; one CLI process serves them all.
  // A write drops the shared read, so a list asked for after a write never sees the config from before it.
  const pendingLists = new Map<string, Promise<readonly SecretMetadata[]>>()
  const run: SecretCliRunner = async request => {
    if (readOnlyCommands.has(request.args[0] ?? '')) return runCli(request)
    pendingLists.clear()
    try {
      return await runCli(request)
    } finally {
      pendingLists.clear()
    }
  }
  const withSignal = (request: Omit<SecretCliRequest, 'signal'>, signal?: AbortSignal): SecretCliRequest =>
    signal === undefined ? request : { ...request, signal }
  const list = async (cwd: string | null): Promise<readonly SecretMetadata[]> => {
    const canonicalCwd = validateCwd(cwd)
    const key = canonicalCwd ?? ''
    const pending = pendingLists.get(key)
    if (pending !== undefined) return pending
    const args = canonicalCwd === null ? ['print', 'global', '--json'] : ['print', '--all', '--json']
    const read = run({ args, cwd: canonicalCwd, captureStdout: true }).then(stdout =>
      parseSecretPrintMetadata(stdout, canonicalCwd === null ? 'global' : 'unknown'),
    )
    pendingLists.set(key, read)
    const forget = (): void => {
      if (pendingLists.get(key) === read) pendingLists.delete(key)
    }
    read.then(forget, forget)
    return read
  }

  const getArguments = (alias: string, scope: SecretScope, cwd: string | null, environment?: string): string[] => {
    const args = ['get', alias]
    if (environment !== undefined && environment.length > 0) args.push(...environmentArguments(environment))
    args.push(...exactConfigArguments(scope, cwd))
    return args
  }

  return {
    list,
    reveal: async (inputAlias, scope, cwd, environment, signal) => {
      const alias = validatedAlias(inputAlias)
      const stdout = await run(withSignal({ args: getArguments(alias, scope, cwd, environment), cwd: validateCwd(cwd), captureStdout: true }, signal))
      return withoutTerminalNewline(stdout)
    },
    copy: async (inputAlias, scope, cwd, environment, signal) => {
      const alias = validatedAlias(inputAlias)
      await run(withSignal({ args: [...getArguments(alias, scope, cwd, environment), '--copy'], cwd: validateCwd(cwd), captureStdout: false }, signal))
      return { copied: true }
    },
    create: async (input, signal) => {
      const alias = validatedAlias(input.alias)
      const environment = Schema.decodeUnknownSync(secretEnvironmentSchemaEffectForCatalog)(input.environment)
      const cwd = input.scope === 'global' ? validateCwd(input.cwd) : requireFolder(input.cwd)
      if (input.valueMode === 'manual' && (input.value === null || input.value.length === 0))
        throw new SecretCatalogOperationError({ message: 'A non-empty value is required for a manual secret.' })
      if (input.valueMode === 'generate' && input.value !== null)
        throw new SecretCatalogOperationError({ message: 'Generated secrets cannot include a submitted value.' })
      const existingRows = await list(cwd)
      if (existingRows.some(row => row.alias === alias && row.environment === environment)) {
        throw new SecretCatalogOperationError({ message: 'An alias with this name already exists in the current environment.' })
      }
      const args = ['set', alias, ...environmentArguments(environment), ...createMetadataArguments(input), ...scopeArguments(input.scope, cwd)]
      if (input.valueMode === 'generate') args.push('--generate')
      const request =
        input.valueMode === 'manual' && input.value !== null ? { args, cwd, captureStdout: false, stdin: input.value } : { args, cwd, captureStdout: false }
      await run(withSignal(request, signal))
      return { created: true }
    },
    update: async (input, signal) => {
      const currentAlias = validatedAlias(input.alias)
      const cwd = input.scope === 'global' ? validateCwd(input.cwd) : requireFolder(input.cwd)
      const metadata = updateMetadataArguments(input)
      const renamed = input.newAlias !== undefined && input.newAlias !== currentAlias
      const alias = renamed && input.newAlias !== undefined ? validatedAlias(input.newAlias) : currentAlias
      if (metadata.length === 0 && input.value === null && !renamed) throw new SecretCatalogOperationError({ message: 'No secret changes were provided.' })
      if (renamed) {
        const existingRows = await list(cwd)
        if (existingRows.some(row => row.alias === alias)) throw new SecretCatalogOperationError({ message: 'An alias with this name already exists.' })
        await run(withSignal({ args: ['mv', currentAlias, alias, ...scopeArguments(input.scope, cwd)], cwd, captureStdout: false }, signal))
      }
      if (metadata.length > 0) {
        await run(
          withSignal(
            {
              args: ['edit', alias, ...metadata, ...environmentArguments(input.environment), ...metadataEditArguments(input.scope, cwd)],
              cwd,
              captureStdout: false,
            },
            signal,
          ),
        )
      }
      if (input.value !== null) {
        await run(
          withSignal(
            {
              args: ['set', alias, '--force', ...environmentArguments(input.environment), ...scopeArguments(input.scope, cwd)],
              cwd,
              captureStdout: false,
              stdin: input.value,
            },
            signal,
          ),
        )
      }
      return { updated: true }
    },
    removeAlias: async (inputAlias, scope, cwd, signal) => {
      const alias = validatedAlias(inputAlias)
      const canonicalCwd = scope === 'global' ? validateCwd(cwd) : requireFolder(cwd)
      await run(withSignal({ args: ['unset', alias, ...scopeArguments(scope, canonicalCwd)], cwd: canonicalCwd, captureStdout: false }, signal))
      return { removed: true }
    },
    deleteItem: async (inputAlias, scope, cwd, environment, signal) => {
      const alias = validatedAlias(inputAlias)
      const canonicalCwd = scope === 'global' ? validateCwd(cwd) : requireFolder(cwd)
      await run(
        withSignal(
          {
            args: ['rm', alias, '--force', ...environmentArguments(environment), ...exactConfigArguments(scope, canonicalCwd)],
            cwd: canonicalCwd,
            captureStdout: false,
          },
          signal,
        ),
      )
      return { deleted: true }
    },
  }
}
