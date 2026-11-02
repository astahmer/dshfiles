import { formatSecretReference, parseSecretReference, type SecretScope } from '@dshfiles/credential-port'
import { secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Effect, Option, Result, Schema } from 'effect'
import { SecretCatalog, type SecretCatalogFailure } from './secret-catalog.js'
import { inspectGlobalSecretConfig } from './secret-global-config.js'
import type { SecretReferenceElsewhere, SecretReferenceState, SecretReferenceStatus } from './secret-reference-status-schema.js'

const MAX_PROBED_FOLDERS = 16

const decodeScope = Schema.decodeUnknownOption(secretScopeSchemaEffect)

const cliState = (error: SecretCatalogFailure): SecretReferenceState => (error._tag === 'SecretCliError' ? error.code : 'cli-failed')

const elsewhereIn = (input: { readonly alias: string; readonly folders: readonly string[] }) =>
  SecretCatalog.use(catalog =>
    Effect.forEach(
      input.folders.slice(0, MAX_PROBED_FOLDERS),
      folder =>
        catalog.list(folder).pipe(
          Effect.map(rows =>
            rows.flatMap((row): SecretReferenceElsewhere[] => {
              const scope = decodeScope(row.scope)
              return row.alias === input.alias && Option.isSome(scope) && scope.value !== 'global'
                ? [{ scope: scope.value, folder, environment: row.environment }]
                : []
            }),
          ),
          Effect.orElseSucceed((): SecretReferenceElsewhere[] => []),
        ),
      { concurrency: 'unbounded' },
    ),
  ).pipe(Effect.map(found => found.flat()))

/**
 * Checks one `secret:ALIAS[@env]` the way a consumer resolves it, and names the first reason it would fail. A matched
 * alias is read on the Host so a missing vault item or a locked vault reports here; the value itself never leaves.
 * A missing alias is also looked up in `probeFolders`, so the answer can say "missing from every scope" or "only in
 * that project", which a consumer resolving global aliases cannot reach.
 */
export const checkSecretReference = Effect.fn('secret reference check')(function* (input: {
  readonly referenceText: string
  readonly cwd: string | null
  readonly probeFolders?: readonly string[] | undefined
}) {
  const catalog = yield* SecretCatalog
  const writeScope: SecretScope = input.cwd === null ? 'global' : 'project'
  const globalConfig = yield* inspectGlobalSecretConfig()
  const base = {
    reference: null,
    alias: null,
    environment: null,
    cwd: input.cwd,
    scope: null,
    environments: [],
    scopes: [],
    elsewhere: [],
    writeScope,
    globalConfig,
  }
  if (input.referenceText.trim() === '') return { ...base, state: 'empty' } satisfies SecretReferenceStatus
  const reference = parseSecretReference(input.referenceText)
  if (reference === null) return { ...base, state: 'invalid-reference' } satisfies SecretReferenceStatus
  const named = { ...base, reference: formatSecretReference(reference), alias: reference.alias, environment: reference.environment }

  const listed = yield* Effect.result(catalog.list(input.cwd))
  if (Result.isFailure(listed)) return { ...named, state: cliState(listed.failure) } satisfies SecretReferenceStatus
  const sameAlias = listed.success.filter(row => row.alias === reference.alias)
  const environments = [...new Set(sameAlias.map(row => row.environment))].sort()
  const matches = sameAlias.filter(row => row.environment === reference.environment)
  const scopes = [...new Set(matches.map(row => row.scope))].sort()
  if (sameAlias.length === 0) {
    const folders = (input.probeFolders ?? []).filter(folder => folder !== input.cwd)
    const elsewhere = yield* elsewhereIn({ alias: reference.alias, folders })
    return { ...named, state: 'alias-missing', elsewhere } satisfies SecretReferenceStatus
  }
  if (matches.length === 0) {
    const aliasScopes = [...new Set(sameAlias.map(row => row.scope))]
    const owningScope = aliasScopes.length === 1 ? decodeScope(aliasScopes[0]) : Option.none()
    return {
      ...named,
      state: 'environment-missing',
      environments,
      writeScope: Option.getOrElse(owningScope, () => writeScope),
    } satisfies SecretReferenceStatus
  }
  if (matches.length > 1) return { ...named, state: 'ambiguous', environments, scopes } satisfies SecretReferenceStatus

  const scope = decodeScope(matches[0]?.scope)
  if (Option.isNone(scope)) return { ...named, state: 'ambiguous', environments, scopes } satisfies SecretReferenceStatus
  const found = { ...named, scope: scope.value, writeScope: scope.value, environments, scopes }
  const revealed = yield* Effect.result(catalog.reveal({ alias: reference.alias, scope: scope.value, cwd: input.cwd, environment: reference.environment }))
  if (Result.isFailure(revealed)) {
    const state = cliState(revealed.failure)
    return { ...found, state: state === 'cli-failed' ? 'value-unreadable' : state } satisfies SecretReferenceStatus
  }
  return { ...found, state: revealed.success.length === 0 ? 'value-empty' : 'resolved' } satisfies SecretReferenceStatus
})
