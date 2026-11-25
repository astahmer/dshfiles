import { BacklogProviders } from '@dshfiles/backlog/backlog-provider'
import type { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Api, DshxPlugin, type HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import type { HttpClient } from 'effect/http'
import { GiteaClient } from './gitea-client.js'
import { GiteaProvider, makeGiteaProvider } from './gitea-provider.js'

const OWNER = '@dshfiles/backlog-gitea'

class Gitea extends Context.Service<Gitea, Effect.Success<ReturnType<typeof makeGiteaProvider>>>()('@dshfiles/backlog-gitea/Gitea') {}

/**
 * The plugin over the HTTP client and secret resolver it is given: the Host entry passes the real ones, a test an
 * in-memory Gitea. It serves the backlog's provider port; the backlog lists it and syncs Gitea repositories through it.
 */
export const makeGiteaPlugin = (input: { readonly services: Layer.Layer<HttpClient.HttpClient | SecretReferenceResolver, never, HostContext> }) =>
  DshxPlugin.make({
    name: OWNER,
    layer: Layer.effect(Gitea, makeGiteaProvider()).pipe(Layer.provide(GiteaClient.layer), Layer.provide(input.services)),
    apis: [
      Api.bind(BacklogProviders.contract(OWNER), {
        describe: () => Effect.succeed({ providers: [GiteaProvider.descriptor] }),
        identity: request => Gitea.use(provider => provider.identity(request.connection)),
        pull: request => Gitea.use(provider => provider.pull(request)),
        fetch: request => Gitea.use(provider => provider.fetch(request)),
        resolve: request => Gitea.use(provider => provider.resolve(request)),
        push: request => Gitea.use(provider => provider.push(request)),
        create: request => Gitea.use(provider => provider.create(request)),
        comment: request => Gitea.use(provider => provider.comment(request)),
        remove: () => Effect.succeed({}),
      }),
    ],
  })

export class GiteaPlugin {
  static readonly owner = OWNER
}
