import type { SecretReferenceResolution } from '@dshfiles/credential-port'
import { secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Effect, Option, Schema } from 'effect'
import { SecretCatalog } from './secret-catalog.js'

const unresolvedMessages = {
  missing: (alias: string, environment: string) => `No secret alias ${alias} is configured for environment ${environment}. Add it in the Secret Catalog first.`,
  ambiguous: (alias: string, environment: string) =>
    `Alias ${alias} exists in several scopes for environment ${environment}; resolve the duplicate with the secret CLI first.`,
  'scope-changed': () => 'The selected secret scope changed. Select the alias again.',
} as const

/** A stored reference that names no single alias of the expected scope; no value was read. */
export class SecretReferenceUnresolved extends Schema.TaggedError<SecretReferenceUnresolved>()(
  'SecretReferenceUnresolved',
  {
    reason: Schema.Literals(['missing', 'ambiguous', 'scope-changed']),
    alias: Schema.String,
    environment: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'secret-reference-unresolved' },
) {
  override get message(): string {
    return unresolvedMessages[this.reason](this.alias, this.environment)
  }
}

/**
 * Resolves a stored `secret:ALIAS[@env]` reference on the Host, through the same CLI path the Catalog reveals with.
 * A folder given by the caller also covers its project and machine-local aliases; without one only global aliases
 * resolve, so a settings field never picks up an unrelated project's secret.
 */
export const resolveSecretValue = Effect.fn('secret resolve')(function* (input: Omit<SecretReferenceResolution, 'signal'>) {
  const catalog = yield* SecretCatalog
  const alias = input.reference.alias
  const environment = input.reference.environment
  yield* Effect.annotateCurrentSpan({ 'secret.alias': alias, 'secret.environment': environment, 'secret.project_scoped': input.cwd !== null })
  const matches = (yield* catalog.list(input.cwd)).filter(row => row.alias === alias && row.environment === environment)
  const [match] = matches
  if (match === undefined) return yield* new SecretReferenceUnresolved({ reason: 'missing', alias, environment })
  if (matches.length > 1) return yield* new SecretReferenceUnresolved({ reason: 'ambiguous', alias, environment })
  const scope = Schema.decodeUnknownOption(secretScopeSchemaEffect)(match.scope)
  if (Option.isNone(scope) || (input.expectedScope !== undefined && scope.value !== input.expectedScope))
    return yield* new SecretReferenceUnresolved({ reason: 'scope-changed', alias, environment })
  yield* Effect.annotateCurrentSpan('secret.scope', scope.value)
  return yield* catalog.reveal({ alias, scope: scope.value, cwd: input.cwd, environment })
})
