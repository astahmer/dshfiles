import { homedir, hostname } from 'node:os'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SecretScope } from '@dshfiles/credential-port'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer, Stream } from 'effect'
import { secretCatalogApi, secretRequestsApi, secretSetupApi } from './api.js'
import { CatalogPorts } from './catalog-ports-promise.js'
import { DshCredentials } from './dsh-credentials-promise.js'
import { SecretCatalog, SecretCatalogOperationError, type SecretCreateInput } from './secret-catalog.js'
import { SecretCli } from './secret-cli.js'
import { checkSecretReference } from './secret-reference-status.js'
import { SecretRequests } from './secret-requests.js'
import { secretTools } from './secret-tools.js'
import { secretCatalogSettings } from './settings.js'

const cwdForScope = (scope: SecretScope, requestedCwd: string | null) => {
  if (scope === 'global') return Effect.succeed(requestedCwd ?? homedir())
  if (requestedCwd === null) return Effect.fail(new SecretCatalogOperationError({ reason: 'folder-required' }))
  return Effect.succeed(requestedCwd)
}

const CatalogLive = SecretCatalog.layer.pipe(Layer.provide(SecretCli.layer), Layer.provide(DshChildProcessSpawner.layer))

/** Tell browsers to read the pending secret requests again whenever one is added or settled. */
const RequestEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const requests = yield* SecretRequests
    yield* requests.changes.pipe(
      Stream.runForEach(() =>
        Api.publish({ contract: secretRequestsApi, event: 'changed', payload: {} }).pipe(
          Effect.catchTag('PublishEventError', error => Effect.logWarning('secret-catalog: request change event refused', error.message)),
        ),
      ),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)

const SecretCatalogLive = Layer.mergeAll(CatalogPorts, RequestEvents).pipe(
  Layer.provideMerge(SecretRequests.layer),
  Layer.provideMerge(Layer.mergeAll(CatalogLive, DshCredentials.layer)),
  Layer.provideMerge(NodeFileSystem.layer),
)

const list = (input: { readonly cwd: string | null }) => SecretCatalog.use(catalog => Effect.map(catalog.list(input.cwd), rows => [...rows]))

const create = Effect.fn('secret catalog create request')(function* (input: SecretCreateInput) {
  const catalog = yield* SecretCatalog
  return yield* catalog.create({ ...input, cwd: yield* cwdForScope(input.scope, input.cwd) })
})

export default DshxPlugin.make({
  name: 'secret-catalog',
  inject: ['connection', 'webServer', 'subprocess'],
  settings: [secretCatalogSettings],
  layer: SecretCatalogLive,
  tools: secretTools,
  apis: [
    Api.bind(secretCatalogApi, {
      list,
      reveal: Effect.fn('secret catalog reveal request')(function* (input) {
        const catalog = yield* SecretCatalog
        return yield* catalog.reveal({ ...input, cwd: yield* cwdForScope(input.scope, input.cwd) })
      }),
      copy: Effect.fn('secret catalog copy request')(function* (input) {
        const catalog = yield* SecretCatalog
        return yield* catalog.copy({ ...input, cwd: yield* cwdForScope(input.scope, input.cwd) })
      }),
      machine: () => Effect.sync(() => ({ id: hostname(), name: hostname() })),
      create,
      update: Effect.fn('secret catalog update request')(function* (input) {
        const catalog = yield* SecretCatalog
        return yield* catalog.update({ ...input, cwd: yield* cwdForScope(input.scope, input.cwd) })
      }),
      removeAlias: Effect.fn('secret catalog remove alias request')(function* (input) {
        const catalog = yield* SecretCatalog
        return yield* catalog.removeAlias({ ...input, cwd: yield* cwdForScope(input.scope, input.cwd) })
      }),
      deleteItem: Effect.fn('secret catalog delete item request')(function* (input) {
        const catalog = yield* SecretCatalog
        return yield* catalog.deleteItem({ ...input, cwd: yield* cwdForScope(input.scope, input.cwd) })
      }),
    }),
    Api.bind(secretSetupApi, {
      list,
      create,
      referenceStatus: input => checkSecretReference({ referenceText: input.reference, cwd: input.cwd, probeFolders: input.probeFolders }),
    }),
    Api.bind(secretRequestsApi, {
      pending: input => SecretRequests.use(requests => Effect.map(requests.pending(input.sessionId), views => ({ requests: [...views] }))),
      complete: input => SecretRequests.use(requests => requests.complete(input)),
      decline: input => SecretRequests.use(requests => requests.decline(input.requestId)),
    }),
  ],
})
