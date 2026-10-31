import { homedir, hostname } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Context as EffectContext, Effect, Layer } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { secretCatalogApi, secretSetupApi } from './api.js'
import { createSecretCatalogOperations, SecretCatalogOperationError, type SecretCatalogOperations } from './secret-operations.js'
import { checkSecretReference } from './secret-reference-status.js'
import { inspectGlobalSecretConfig } from './secret-global-config.js'
import { runSecretCli } from './secret-cli-runner.js'
import { createSecretTools } from './secret-tools.js'
import { secretCatalogSettings } from './settings.js'
import { createSecretCatalogCredentialBridge } from './credential-bridge.js'
import { createSecretCatalogValues } from './secret-reference-resolver.js'
import { secretCatalogChange, secretCatalogQuery } from './secret-catalog-effect.js'

interface SecretCatalogHostRuntime {
  readonly operations: SecretCatalogOperations
  readonly credentials: ReturnType<typeof createSecretCatalogCredentialBridge>
  readonly values: ReturnType<typeof createSecretCatalogValues>
}

class SecretCatalogHost extends EffectContext.Service<SecretCatalogHost, SecretCatalogHostRuntime>()('dshfiles/secret-catalog/SecretCatalogHost') {}

const operationsByContext = new WeakMap<Context, SecretCatalogOperations>()
let hostContext: Context | undefined

/** One operations instance per plugin runtime, so concurrent metadata reads share one CLI process. */
const hostLayer = (ctx: Context) => {
  const operations = createSecretCatalogOperations(request => runSecretCli(ctx.subprocess, request))
  const credentials = createSecretCatalogCredentialBridge({ operations, getCredentials: () => ctx.get('credentials') })
  const values = createSecretCatalogValues({ operations })
  return Layer.succeed(SecretCatalogHost, { operations, credentials, values })
}

const catalogPlugin = DshxEffect.plugin({
  layer: hostLayer,
  setup: (ctx: Context) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          hostContext = ctx
          operationsByContext.set(ctx, active.operations)
          ctx.provide('secretCatalogCredentials', active.credentials)
          ctx.provide('secretCatalogValues', active.values)
        }),
        () =>
          Effect.sync(() => {
            if (hostContext === ctx) hostContext = undefined
            operationsByContext.delete(ctx)
          }),
      )
    }),
})
const cwdForScope = (scope: string, requestedCwd: string | null): string | null => {
  if (scope === 'global') return requestedCwd ?? homedir()
  if (scope === 'project' || scope === 'local') {
    if (requestedCwd === null) throw new SecretCatalogOperationError({ message: 'Choose a project folder for this alias scope.' })
    return requestedCwd
  }
  return requestedCwd
}

const catalogHostApi = catalogPlugin.hostApi(secretCatalogApi, {
  list: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogQuery(_signal => active.operations.list(input.cwd).then(rows => [...rows]))
    }),
  reveal: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogQuery(requestSignal =>
        active.operations.reveal(input.alias, input.scope, cwdForScope(input.scope, input.cwd), input.environment, requestSignal),
      )
    }),
  copy: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogQuery(requestSignal =>
        active.operations.copy(input.alias, input.scope, cwdForScope(input.scope, input.cwd), input.environment, requestSignal),
      )
    }),
  machine: () =>
    Effect.sync(() => {
      const name = hostname()
      return { id: name, name }
    }),
  create: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogChange(requestSignal => active.operations.create({ ...input, cwd: cwdForScope(input.scope, input.cwd) }, requestSignal))
    }),
  update: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogChange(requestSignal => active.operations.update({ ...input, cwd: cwdForScope(input.scope, input.cwd) }, requestSignal))
    }),
  removeAlias: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogChange(requestSignal =>
        active.operations.removeAlias(input.alias, input.scope, cwdForScope(input.scope, input.cwd), requestSignal),
      )
    }),
  deleteItem: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogChange(requestSignal =>
        active.operations.deleteItem(input.alias, input.scope, cwdForScope(input.scope, input.cwd), input.environment, requestSignal),
      )
    }),
})

const setupHostApi = catalogPlugin.hostApi(secretSetupApi, {
  list: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogQuery(_signal => active.operations.list(input.cwd).then(rows => [...rows]))
    }),
  create: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogChange(requestSignal => active.operations.create({ ...input, cwd: cwdForScope(input.scope, input.cwd) }, requestSignal))
    }),
  referenceStatus: ({ input }) =>
    Effect.gen(function* () {
      const active = yield* SecretCatalogHost
      return yield* secretCatalogQuery(requestSignal =>
        checkSecretReference({
          operations: active.operations,
          referenceText: input.reference,
          cwd: input.cwd,
          probeFolders: input.probeFolders ?? [],
          inspectGlobalConfig: () => inspectGlobalSecretConfig(),
          signal: requestSignal,
        }),
      )
    }),
})

const tools = createSecretTools(() => {
  if (hostContext === undefined) throw new Error('Secret Catalog Host is not active.')
  const operations = operationsByContext.get(hostContext)
  if (operations === undefined) throw new Error('Secret Catalog Host is not active.')
  return operations
})

export default defineHost({
  name: 'secret-catalog',
  inject: ['connection', 'webServer', 'subprocess'],
  apis: [catalogHostApi, setupHostApi],
  tools,
  settings: [secretCatalogSettings],
  setup: catalogPlugin.setup,
})
