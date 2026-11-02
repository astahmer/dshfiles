import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Context, Effect, Layer, Schema } from 'effect'
import { VcsProviders } from './index.js'

export class VcsProviderOwnersError extends Schema.TaggedError<VcsProviderOwnersError>()('VcsProviderOwnersError', {
  message: Schema.String,
}) {}

export class VcsProviderResolveError extends Schema.TaggedError<VcsProviderResolveError>()('VcsProviderResolveError', {
  message: Schema.String,
}) {}

export class VcsProviderService extends Context.Service<
  VcsProviderService,
  {
    contract(owner: string): ReturnType<typeof VcsProviders.contract>
    owners(): Effect.Effect<string[], VcsProviderOwnersError>
    resolve(input: {
      readonly path: string
      readonly callerPackageId: string
    }): Effect.Effect<Awaited<ReturnType<typeof VcsProviders.resolve>>, VcsProviderResolveError>
  }
>()('@dshfiles/vcs-provider-port/VcsProvider') {
  static layer(context: CordisContext) {
    return Layer.succeed(
      VcsProviderService,
      VcsProviderService.of({
        contract: owner => VcsProviders.contract(owner),
        owners: Effect.fn('vcs providers list')(() =>
          Effect.try({
            try: () => VcsProviders.owners(context),
            catch: () => new VcsProviderOwnersError({ message: 'Could not list VCS providers.' }),
          }),
        ),
        resolve: Effect.fn('vcs provider resolve')(input =>
          Effect.tryPromise({
            try: signal => VcsProviders.resolve(context, { ...input, signal }),
            catch: () => new VcsProviderResolveError({ message: 'Could not resolve a VCS provider.' }),
          }),
        ),
      }),
    )
  }
}
