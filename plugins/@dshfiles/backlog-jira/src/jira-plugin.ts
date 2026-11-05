import { BacklogProviders } from '@dshfiles/backlog/backlog-provider'
import type { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Api, DshxPlugin, type HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import type { HttpClient } from 'effect/http'
import { JiraClient, type JiraClientOptions } from './jira-client.js'
import { JiraProvider, makeJiraProvider } from './jira-provider.js'

const OWNER = '@dshfiles/backlog-jira'

class Jira extends Context.Service<Jira, Effect.Success<ReturnType<typeof makeJiraProvider>>>()('@dshfiles/backlog-jira/Jira') {}

/**
 * The plugin over the HTTP client and secret resolver it is given: the Host entry passes the real ones, a test an
 * in-memory Jira. It serves the backlog's provider port; the backlog lists it and syncs Jira projects through it.
 */
export const makeJiraPlugin = (input: {
  readonly services: Layer.Layer<HttpClient.HttpClient | SecretReferenceResolver, never, HostContext>
  readonly client?: JiraClientOptions
}) =>
  DshxPlugin.make({
    name: OWNER,
    layer: Layer.effect(Jira, makeJiraProvider()).pipe(Layer.provide(JiraClient.layer(input.client)), Layer.provide(input.services)),
    apis: [
      Api.bind(BacklogProviders.contract(OWNER), {
        describe: () => Effect.succeed({ providers: [JiraProvider.descriptor] }),
        identity: request => Jira.use(provider => provider.identity(request.connection)),
        pull: request => Jira.use(provider => provider.pull(request)),
        fetch: request => Jira.use(provider => provider.fetch(request)),
        resolve: request => Jira.use(provider => provider.resolve(request)),
        push: request => Jira.use(provider => provider.push(request)),
        create: request => Jira.use(provider => provider.create(request)),
        comment: request => Jira.use(provider => provider.comment(request)),
        remove: request => Jira.use(provider => Effect.as(provider.remove(request), {})),
      }),
    ],
  })

export class JiraPlugin {
  static readonly owner = OWNER
}
