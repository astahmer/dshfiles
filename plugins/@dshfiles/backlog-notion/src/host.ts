import { BacklogProviders } from '@dshfiles/backlog/backlog-provider'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { NotionClient } from './notion-client.js'
import { makeNotionProvider, NotionProvider } from './notion-provider.js'

const OWNER = '@dshfiles/backlog-notion'

class Notion extends Context.Service<Notion, Effect.Success<ReturnType<typeof makeNotionProvider>>>()('@dshfiles/backlog-notion/Notion') {
  static readonly layer = Layer.effect(Notion, makeNotionProvider()).pipe(
    Layer.provide(NotionClient.layer()),
    Layer.provide(Layer.mergeAll(FetchHttpClient.layer, SecretReferenceResolver.layer)),
  )
}

/** Serves the backlog's provider port: the backlog lists this plugin and syncs Notion data sources through it. */
export default DshxPlugin.make({
  name: OWNER,
  layer: Notion.layer,
  apis: [
    Api.bind(BacklogProviders.contract(OWNER), {
      describe: () => Effect.succeed({ providers: [NotionProvider.descriptor] }),
      identity: input => Notion.use(provider => provider.identity(input.connection)),
      pull: input => Notion.use(provider => provider.pull(input)),
      fetch: input => Notion.use(provider => provider.fetch(input)),
      resolve: input => Notion.use(provider => provider.resolve(input)),
      push: input => Notion.use(provider => provider.push(input)),
      create: input => Notion.use(provider => provider.create(input)),
      comment: input => Notion.use(provider => provider.comment(input)),
      remove: input => Notion.use(provider => Effect.as(provider.remove(input), {})),
    }),
  ],
})
