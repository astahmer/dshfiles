import type { SecretCatalogKeyOption, SecretScope } from '@dshfiles/credential-port'
import { secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Effect, Option, Schema } from 'effect'
import { DshCredentials } from './dsh-credentials-promise.js'
import { SecretCatalog } from './secret-catalog.js'

const importRefusals = {
  'target-not-api-key': 'Choose an API-key variable ending in _API_KEY.',
  'target-read-only': 'That variable is supplied by a read-only source; choose another API-key variable.',
  'target-configured': 'That API-key variable already has a value; confirm replacement or choose another reference.',
  'folder-required': 'Choose a project folder for this alias scope.',
  'entry-unavailable': 'That Secret Catalog entry is unavailable or ambiguous.',
  'entry-unreadable': 'The selected Secret Catalog entry could not be read.',
  'entry-empty': 'The selected Secret Catalog entry is empty.',
} as const

/** A key import the bridge refused before or instead of storing a value. */
export class SecretKeyImportRefused extends Schema.TaggedError<SecretKeyImportRefused>()('SecretKeyImportRefused', {
  reason: Schema.Literals([
    'target-not-api-key',
    'target-read-only',
    'target-configured',
    'folder-required',
    'entry-unavailable',
    'entry-unreadable',
    'entry-empty',
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return importRefusals[this.reason]
  }
}

export interface SecretKeyImportRequest {
  readonly alias: string
  readonly environment: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly targetRef: string
  readonly replaceExisting?: boolean | undefined
}

const apiKeyRefPattern = /^[A-Z][A-Z0-9_]*_API_KEY$/

const refuse = (reason: typeof SecretKeyImportRefused.fields.reason.Type) => Effect.fail(new SecretKeyImportRefused({ reason }))

const uniqueRows = Effect.fn('secret credential bridge rows')(function* (cwd: string | null) {
  const catalog = yield* SecretCatalog
  const rows = yield* catalog.list(cwd)
  const scopedRows = rows.flatMap(row => {
    const scope = Schema.decodeUnknownOption(secretScopeSchemaEffect)(row.scope)
    return Option.isSome(scope) ? [{ row, scope: scope.value }] : []
  })
  const keyOf = (entry: (typeof scopedRows)[number]) => JSON.stringify([entry.scope, entry.row.alias, entry.row.environment])
  const counts = new Map<string, number>()
  for (const entry of scopedRows) counts.set(keyOf(entry), (counts.get(keyOf(entry)) ?? 0) + 1)
  return scopedRows.filter(entry => counts.get(keyOf(entry)) === 1)
})

/** Value-free key options for a credential picker: only aliases that name exactly one entry in a supported scope. */
export const listCredentialKeys = Effect.fn('secret credential bridge list keys')(function* (cwd: string | null) {
  const rows = yield* uniqueRows(cwd)
  return rows.map((entry): SecretCatalogKeyOption => ({
    alias: entry.row.alias,
    environment: entry.row.environment,
    scope: entry.scope,
    cwd: entry.scope === 'global' ? null : cwd,
    variableName: entry.row.variableName,
    service: entry.row.service,
    description: entry.row.description,
  }))
})

/** Copy one catalog value into DSH's write-only credential store, refusing read-only or already configured targets. */
export const importCredentialKey = Effect.fn('secret credential bridge import key')(function* (request: SecretKeyImportRequest) {
  if (!apiKeyRefPattern.test(request.targetRef)) return yield* refuse('target-not-api-key')
  const credentials = yield* DshCredentials
  const target = yield* credentials.describe(request.targetRef)
  if (!target.writable) return yield* refuse('target-read-only')
  if (target.configured && request.replaceExisting !== true) return yield* refuse('target-configured')

  if (request.scope !== 'global' && request.cwd === null) return yield* refuse('folder-required')
  const cwd = request.scope === 'global' ? null : request.cwd
  const matches = (yield* uniqueRows(cwd)).filter(
    entry => entry.scope === request.scope && entry.row.alias === request.alias && entry.row.environment === request.environment,
  )
  if (matches.length !== 1) return yield* refuse('entry-unavailable')

  const catalog = yield* SecretCatalog
  const value = yield* catalog
    .reveal({ alias: request.alias, scope: request.scope, cwd, environment: request.environment })
    .pipe(Effect.mapError(cause => new SecretKeyImportRefused({ reason: 'entry-unreadable', cause })))
  if (value.length === 0) return yield* refuse('entry-empty')
  yield* credentials.set(request.targetRef, value)
})
