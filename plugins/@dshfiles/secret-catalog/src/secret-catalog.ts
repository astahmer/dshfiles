import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { SecretScope } from '@dshfiles/credential-port'
import { Cache, Context, Duration, Effect, Layer, Schema, Semaphore } from 'effect'
import {
  createMetadataSchemaEffect,
  secretAliasSchemaEffectForCatalog,
  secretEnvironmentSchemaEffectForCatalog,
  updateMetadataSchemaEffect,
} from './secret-arguments-effect.js'
import { SecretCli, type SecretCliError, type SecretCliRequest } from './secret-cli.js'
import { decodeSecretPrintMetadata, type SecretMetadata } from './secret-metadata.js'

const operationFailures = {
  'folder-not-canonical': 'A canonical absolute folder path is required.',
  'folder-required': 'Choose a project folder for this alias scope.',
  'manual-value-required': 'A non-empty value is required for a manual secret.',
  'generated-value-submitted': 'Generated secrets cannot include a submitted value.',
  'alias-exists-in-environment': 'An alias with this name already exists in the current environment.',
  'alias-exists': 'An alias with this name already exists.',
  'no-changes': 'No secret changes were provided.',
  'invalid-argument': 'The alias, environment or metadata is not accepted by the secret CLI.',
  'invalid-cli-output': 'The secret CLI returned metadata in an unexpected shape.',
} as const

export const SecretCatalogOperationReason = Schema.Literals([
  'folder-not-canonical',
  'folder-required',
  'manual-value-required',
  'generated-value-submitted',
  'alias-exists-in-environment',
  'alias-exists',
  'no-changes',
  'invalid-argument',
  'invalid-cli-output',
])

export class SecretCatalogOperationError extends Schema.TaggedError<SecretCatalogOperationError>()(
  'SecretCatalogOperationError',
  { reason: SecretCatalogOperationReason, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'secret-catalog-operation-error' },
) {
  override get message(): string {
    return operationFailures[this.reason]
  }
}

export type SecretCatalogFailure = SecretCliError | SecretCatalogOperationError

const refuse = (reason: typeof SecretCatalogOperationReason.Type) => Effect.fail(new SecretCatalogOperationError({ reason }))

const invalidArgument = (cause: Schema.SchemaError) => new SecretCatalogOperationError({ reason: 'invalid-argument', cause })

const validAlias = (alias: string) => Schema.decodeEffect(secretAliasSchemaEffectForCatalog)(alias).pipe(Effect.mapError(invalidArgument))

const validEnvironment = (environment: string) =>
  Schema.decodeEffect(secretEnvironmentSchemaEffectForCatalog)(environment).pipe(Effect.mapError(invalidArgument))

const validateCwd = (cwd: string | null) => (cwd !== null && (!isAbsolute(cwd) || resolve(cwd) !== cwd) ? refuse('folder-not-canonical') : Effect.succeed(cwd))

const requireFolder = (cwd: string | null) => Effect.flatMap(validateCwd(cwd), folder => (folder === null ? refuse('folder-required') : Effect.succeed(folder)))

const scopedFolder = (scope: SecretScope, cwd: string | null) => (scope === 'global' ? validateCwd(cwd) : requireFolder(cwd))

const withoutTerminalNewline = (value: string): string => {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
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
  readonly newAlias?: string
  readonly name?: string
  readonly source?: string
  readonly tags?: string
}

export interface SecretValueInput {
  readonly alias: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly environment?: string | undefined
}

const definedOnly = (metadata: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(Object.entries(metadata).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])))

const flagArguments = (metadata: Readonly<Record<string, string | undefined>>): string[] =>
  Object.entries(metadata).flatMap(([flag, value]) => (value === undefined ? [] : [`--${flag}`, value]))

const createMetadataArguments = (input: SecretCreateInput) =>
  Effect.map(
    Schema.decodeEffect(createMetadataSchemaEffect)(
      definedOnly({ name: input.name, source: input.source, tags: input.tags, type: input.type, field: input.field }),
    ),
    flagArguments,
  ).pipe(Effect.mapError(invalidArgument))

const updateMetadataArguments = (input: SecretUpdateInput) =>
  Effect.map(Schema.decodeEffect(updateMetadataSchemaEffect)(definedOnly({ name: input.name, source: input.source, tags: input.tags })), flagArguments).pipe(
    Effect.mapError(invalidArgument),
  )

const scopeArguments = (scope: SecretScope, folder: string | null): string[] => {
  if (scope === 'global') return ['--global']
  if (scope === 'local' && folder !== null) return ['--config', join(folder, '.secret.local.json')]
  return []
}

const exactConfigArguments = (scope: SecretScope, folder: string | null): string[] => {
  if (scope === 'global') return ['--config', join(homedir(), '.config', 'secret', 'config.json')]
  if (scope === 'local' && folder !== null) return ['--config', join(folder, '.secret.local.json')]
  return []
}

const localFolder = (scope: SecretScope, cwd: string | null) => (scope === 'local' ? requireFolder(cwd) : validateCwd(cwd))

const getArguments = Effect.fnUntraced(function* (input: SecretValueInput) {
  const alias = yield* validAlias(input.alias)
  const folder = yield* localFolder(input.scope, input.cwd)
  const environment = input.environment === undefined || input.environment.length === 0 ? [] : ['--env', yield* validEnvironment(input.environment)]
  return { args: ['get', alias, ...environment, ...exactConfigArguments(input.scope, folder)], cwd: yield* validateCwd(input.cwd) }
})

export interface SecretCatalogShape {
  readonly list: (cwd: string | null) => Effect.Effect<readonly SecretMetadata[], SecretCatalogFailure>
  readonly reveal: (input: SecretValueInput) => Effect.Effect<string, SecretCatalogFailure>
  readonly copy: (input: SecretValueInput) => Effect.Effect<{ readonly copied: true }, SecretCatalogFailure>
  readonly create: (input: SecretCreateInput) => Effect.Effect<{ readonly created: true }, SecretCatalogFailure>
  readonly update: (input: SecretUpdateInput) => Effect.Effect<{ readonly updated: true }, SecretCatalogFailure>
  readonly removeAlias: (input: Omit<SecretValueInput, 'environment'>) => Effect.Effect<{ readonly removed: true }, SecretCatalogFailure>
  readonly deleteItem: (input: SecretValueInput & { readonly environment: string }) => Effect.Effect<{ readonly deleted: true }, SecretCatalogFailure>
}

/**
 * Alias metadata and exact alias actions through the secret CLI. Panel, picker, setup offer and reference checks
 * list the same folder at once, so one CLI process serves every concurrent list of a folder; writes run one at a time
 * and drop the shared reads, so a list asked for after a write never sees the config from before it.
 */
export class SecretCatalog extends Context.Service<SecretCatalog, SecretCatalogShape>()('@dshfiles/secret-catalog/SecretCatalog') {
  static readonly layer = Layer.effect(
    SecretCatalog,
    Effect.gen(function* () {
      const cli = yield* SecretCli
      const writes = yield* Semaphore.make(1)

      const listFolder = (folder: string | null) =>
        cli.run({ args: folder === null ? ['print', 'global', '--json'] : ['print', '--all', '--json'], cwd: folder, captureStdout: true }).pipe(
          Effect.flatMap(stdout => decodeSecretPrintMetadata({ jsonText: stdout, defaultScope: folder === null ? 'global' : 'unknown' })),
          Effect.mapError(error => (error._tag === 'SecretCliError' ? error : new SecretCatalogOperationError({ reason: 'invalid-cli-output', cause: error }))),
        )
      const lists = yield* Cache.make({ capacity: 64, timeToLive: Duration.zero, lookup: (key: string) => listFolder(key === '' ? null : key) })

      const write = (request: SecretCliRequest) =>
        Cache.invalidateAll(lists).pipe(Effect.andThen(cli.run(request)), Effect.ensuring(Cache.invalidateAll(lists)), Effect.asVoid)

      const list = Effect.fn('secret catalog list')(function* (cwd: string | null) {
        const folder = yield* validateCwd(cwd)
        return yield* Cache.get(lists, folder ?? '')
      })

      const create = Effect.fn('secret catalog create')(function* (input: SecretCreateInput) {
        const alias = yield* validAlias(input.alias)
        const environment = yield* validEnvironment(input.environment)
        const folder = yield* scopedFolder(input.scope, input.cwd)
        if (input.valueMode === 'manual' && (input.value === null || input.value.length === 0)) return yield* refuse('manual-value-required')
        if (input.valueMode === 'generate' && input.value !== null) return yield* refuse('generated-value-submitted')
        const metadata = yield* createMetadataArguments(input)
        const existingRows = yield* list(folder)
        if (existingRows.some(row => row.alias === alias && row.environment === environment)) return yield* refuse('alias-exists-in-environment')
        const args = ['set', alias, '--env', environment, ...metadata, ...scopeArguments(input.scope, folder)]
        if (input.valueMode === 'generate') args.push('--generate')
        yield* write(
          input.valueMode === 'manual' && input.value !== null
            ? { args, cwd: folder, captureStdout: false, stdin: input.value }
            : { args, cwd: folder, captureStdout: false },
        )
        return { created: true } as const
      })

      const update = Effect.fn('secret catalog update')(function* (input: SecretUpdateInput) {
        const currentAlias = yield* validAlias(input.alias)
        const folder = yield* scopedFolder(input.scope, input.cwd)
        const metadata = yield* updateMetadataArguments(input)
        const renamed = input.newAlias !== undefined && input.newAlias !== currentAlias
        const alias = renamed && input.newAlias !== undefined ? yield* validAlias(input.newAlias) : currentAlias
        if (metadata.length === 0 && input.value === null && !renamed) return yield* refuse('no-changes')
        const environment = yield* validEnvironment(input.environment)
        if (renamed) {
          const existingRows = yield* list(folder)
          if (existingRows.some(row => row.alias === alias)) return yield* refuse('alias-exists')
          yield* write({ args: ['mv', currentAlias, alias, ...scopeArguments(input.scope, folder)], cwd: folder, captureStdout: false })
        }
        if (metadata.length > 0)
          yield* write({
            args: ['edit', alias, ...metadata, '--env', environment, ...exactConfigArguments(input.scope, folder)],
            cwd: folder,
            captureStdout: false,
          })
        if (input.value !== null)
          yield* write({
            args: ['set', alias, '--force', '--env', environment, ...scopeArguments(input.scope, folder)],
            cwd: folder,
            captureStdout: false,
            stdin: input.value,
          })
        return { updated: true } as const
      })

      return SecretCatalog.of({
        list,
        reveal: Effect.fn('secret catalog reveal')(function* (input) {
          const request = yield* getArguments(input)
          return withoutTerminalNewline(yield* cli.run({ ...request, captureStdout: true }))
        }),
        copy: Effect.fn('secret catalog copy')(function* (input) {
          const request = yield* getArguments(input)
          yield* cli.run({ args: [...request.args, '--copy'], cwd: request.cwd, captureStdout: false })
          return { copied: true } as const
        }),
        create: input => writes.withPermit(create(input)),
        update: input => writes.withPermit(update(input)),
        removeAlias: Effect.fn('secret catalog remove alias')(function* (input) {
          const alias = yield* validAlias(input.alias)
          const folder = yield* scopedFolder(input.scope, input.cwd)
          yield* writes.withPermit(write({ args: ['unset', alias, ...scopeArguments(input.scope, folder)], cwd: folder, captureStdout: false }))
          return { removed: true } as const
        }),
        deleteItem: Effect.fn('secret catalog delete item')(function* (input) {
          const alias = yield* validAlias(input.alias)
          const environment = yield* validEnvironment(input.environment)
          const folder = yield* scopedFolder(input.scope, input.cwd)
          yield* writes.withPermit(
            write({ args: ['rm', alias, '--force', '--env', environment, ...exactConfigArguments(input.scope, folder)], cwd: folder, captureStdout: false }),
          )
          return { deleted: true } as const
        }),
      })
    }),
  )
}
