import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Context, Effect, Layer, Option, Redacted } from 'effect'
import { BacklogProviderFailed, type ProviderConnection } from './provider-port.js'

export interface ResolvedCredential {
  readonly key: Redacted.Redacted
  readonly source: 'reference' | 'environment' | 'cli'
}

/**
 * Turns a connection's `secret:ALIAS` reference into a key on the Host: the reference, then the Host environment, then
 * a fallback the provider names (the `gh` CLI for GitHub). The value never leaves the Host.
 */
export class ProviderCredentials extends Context.Service<
  ProviderCredentials,
  {
    readonly resolve: (input: {
      readonly provider: string
      readonly connection: Pick<ProviderConnection, 'credential'>
      readonly environmentVariables: readonly string[]
      readonly fallback?: Effect.Effect<Option.Option<Redacted.Redacted>> | undefined
      /** How to sign the fallback tool in, named in the failure so the message is actionable. */
      readonly fallbackHint?: string | undefined
    }) => Effect.Effect<ResolvedCredential, BacklogProviderFailed>
  }
>()('@dshfiles/backlog/ProviderCredentials') {
  static readonly layer = Layer.effect(
    ProviderCredentials,
    Effect.gen(function* () {
      const secrets = yield* SecretReferenceResolver
      const resolve = Effect.fnUntraced(function* (input: {
        readonly provider: string
        readonly connection: Pick<ProviderConnection, 'credential'>
        readonly environmentVariables: readonly string[]
        readonly fallback?: Effect.Effect<Option.Option<Redacted.Redacted>> | undefined
        readonly fallbackHint?: string | undefined
      }) {
        const reference = input.connection.credential.trim()
        const environment = input.environmentVariables.map(name => ({ name, value: process.env[name] ?? '' })).find(variable => variable.value !== '')
        const resolved = yield* secrets
          .resolveWithLabel({
            referenceText: reference,
            environmentValue: environment?.value,
            environmentVariableName: environment?.name ?? input.environmentVariables[0] ?? 'environment',
          })
          .pipe(
            Effect.catch(cause =>
              Effect.fail(
                new BacklogProviderFailed({
                  provider: input.provider,
                  code: 'credential-missing',
                  detail: 'the Secret Catalog could not resolve the reference',
                  cause,
                }),
              ),
            ),
          )
        if (Option.isSome(resolved))
          return { key: Redacted.make(resolved.value.value), source: reference === '' ? 'environment' : 'reference' } satisfies ResolvedCredential
        if (reference === '' && input.fallback !== undefined) {
          const fallback = yield* input.fallback
          if (Option.isSome(fallback)) return { key: fallback.value, source: 'cli' } satisfies ResolvedCredential
        }
        const variables = input.environmentVariables.join(' or ')
        const unset = variables === '' ? '' : `${variables} is not set on the Host`
        const cli = input.fallbackHint === undefined ? '' : `and ${input.fallbackHint} did not answer`
        const detail = [unset, cli].filter(part => part !== '').join(' ')
        return yield* new BacklogProviderFailed({
          provider: input.provider,
          code: 'credential-missing',
          detail: detail === '' ? 'no key is bound' : `no key is bound: ${detail}`,
        })
      })
      return ProviderCredentials.of({ resolve })
    }),
  )
}
