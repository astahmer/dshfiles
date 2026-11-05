import { BacklogProviders } from '@dshfiles/backlog/backlog-provider'
import type { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Api, DshxPlugin, type HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import type { HttpClient } from 'effect/http'
import { NotionClient, type NotionClientOptions } from './notion-client.js'
import { makeNotionProvider, NotionProvider } from './notion-provider.js'

const OWNER = '@dshfiles/backlog-notion'

class Notion extends Context.Service<Notion, Effect.Success<ReturnType<typeof makeNotionProvider>>>()('@dshfiles/backlog-notion/Notion') {}

/**
 * The plugin over the HTTP client and secret resolver it is given: the Host entry passes the real ones, a test an
 * in-memory Notion. It serves the backlog's provider port; the backlog lists it and syncs Notion data sources through it.
 */
export const makeNotionPlugin = (input: {
  readonly services: Layer.Layer<HttpClient.HttpClient | SecretReferenceResolver, never, HostContext>
  readonly client?: NotionClientOptions
}) =>
  DshxPlugin.make({
    name: OWNER,
    layer: Layer.effect(Notion, makeNotionProvider()).pipe(Layer.provide(NotionClient.layer(input.client)), Layer.provide(input.services)),
    apis: [
      Api.bind(BacklogProviders.contract(OWNER), {
        describe: () => Effect.succeed({ providers: [NotionProvider.descriptor] }),
        identity: request => Notion.use(provider => provider.identity(request.connection)),
        pull: request => Notion.use(provider => provider.pull(request)),
        fetch: request => Notion.use(provider => provider.fetch(request)),
        resolve: request => Notion.use(provider => provider.resolve(request)),
        push: request => Notion.use(provider => provider.push(request)),
        create: request => Notion.use(provider => provider.create(request)),
        comment: request => Notion.use(provider => provider.comment(request)),
        remove: request => Notion.use(provider => Effect.as(provider.remove(request), {})),
      }),
    ],
  })

export class NotionPlugin {
  static readonly owner = OWNER
}
