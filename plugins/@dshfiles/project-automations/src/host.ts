import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Api, DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Effect, Layer } from 'effect'
import { automationsApi } from './automations-api.js'
import { AutomationOrigin, AutomationsService } from './automations-service.js'
import { AutomationProjects, AutomationRunner, AutomationSessions } from './automation-runner.js'
import { AutomationStore } from './automation-store.js'
import { runScheduler } from './scheduler.js'
import { handleWebhook, WEBHOOK_PATH, WebhookGuards } from './webhook-route.js'

const PACKAGE_ID = '@dshfiles/project-automations'

/** jj-integration cuts thread workspaces at `<repository>-threads/<name>`: those are work in progress, not projects. */
const isThreadWorkspace = (path: string): boolean => {
  const parts = path.replace(/\/+$/u, '').split('/')
  const parent = parts.at(-2) ?? ''
  return (parent.length > '-threads'.length && parent.endsWith('-threads')) || /^thread-[0-9a-f]{6}$/u.test(parts.at(-1) ?? '')
}

const SessionsLive = Layer.effect(
  AutomationSessions,
  Effect.map(HostContext, host => Api.client({ contract: sessionsApi, api: createHostApiClient(host.ctx, sessionsApi, PACKAGE_ID) })),
)

const ProjectsLive = Layer.effect(
  AutomationProjects,
  Effect.map(hostService('workspaceRegistry'), registry =>
    AutomationProjects.of({
      list: Effect.sync(() =>
        registry
          .list()
          .filter(workspace => !isThreadWorkspace(workspace.path))
          .map(workspace => ({ projectId: workspace.id, title: workspace.title, path: workspace.path })),
      ),
    }),
  ),
)

/** Where the Host web server answers, so a webhook path becomes a URL the user can copy. */
const OriginLive = Layer.effect(
  AutomationOrigin,
  Effect.map(hostService('webServer'), web => AutomationOrigin.of({ origin: Effect.sync(() => (web.port === undefined ? null : web.getOrigin())) })),
)

/** Serve `/automations/webhook/<id>` on the Host web server while the plugin is active. */
const WebhookRouteLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* hostService('webServer')
    const handler = yield* DshxPlugin.callback((request: IncomingMessage, response: ServerResponse) => handleWebhook({ request, response }))
    yield* Effect.acquireRelease(
      Effect.sync(() => server.register({ kind: 'prefix', path: WEBHOOK_PATH, handler })),
      unregister => Effect.sync(unregister),
    )
  }),
)

const CoreLive = AutomationRunner.layer.pipe(Layer.provideMerge(Layer.mergeAll(AutomationStore.layer, SessionsLive, ProjectsLive)))

const AutomationsLive = Layer.mergeAll(AutomationsService.layer, WebhookRouteLive).pipe(
  Layer.provideMerge(Layer.mergeAll(CoreLive, OriginLive, WebhookGuards.layer, SecretReferenceResolver.layer)),
)

export default DshxPlugin.make({
  name: 'dshfiles-project-automations',
  inject: ['workspaceRegistry', 'webServer'],
  layer: AutomationsLive,
  main: runScheduler,
  apis: [
    Api.bind(automationsApi, {
      list: () => AutomationsService.use(service => service.list()),
      runs: input => AutomationsService.use(service => service.runs(input)),
      projects: () => AutomationsService.use(service => service.projects),
      save: input => AutomationsService.use(service => service.save(input)),
      setEnabled: input => AutomationsService.use(service => service.setEnabled(input)),
      runNow: input => AutomationsService.use(service => service.runNow(input)),
      delete: input => AutomationsService.use(service => service.remove(input)),
    }),
  ],
})
