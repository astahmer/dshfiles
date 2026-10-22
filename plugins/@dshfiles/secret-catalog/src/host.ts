import { homedir, hostname } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { defineHost } from '@dshfiles/dshx/host'
import { secretCatalogApi, secretSetupApi } from './api.js'
import { createSecretCatalogOperations, type SecretCreateInput } from './secret-operations.js'
import { runSecretCli } from './secret-cli-runner.js'
import { createSecretTools } from './secret-tools.js'
import { secretCatalogSettings } from './settings.js'
import { createSecretCatalogCredentialBridge } from './credential-bridge.js'
import { createSecretCatalogValues } from './secret-reference-resolver.js'

export type { SecretCatalogCredentialBridge, SecretCatalogKeyOption } from './credential-bridge.js'

const operationsFor = (ctx: Context) => createSecretCatalogOperations(request => runSecretCli(ctx.subprocess, request))
const cwdForScope = (scope: string, requestedCwd: string | null): string | null => {
  if (scope === 'global') return requestedCwd ?? homedir()
  if (scope === 'project' || scope === 'local') {
    if (requestedCwd === null) throw new Error('Choose a project folder for this alias scope.')
    return requestedCwd
  }
  return requestedCwd
}

const listSecretMetadata = async (cwd: string | null, ctx: Context) => [...(await operationsFor(ctx).list(cwd))]
const createCatalogSecret = (input: SecretCreateInput, ctx: Context) => operationsFor(ctx).create({ ...input, cwd: cwdForScope(input.scope, input.cwd) })

const api = secretCatalogApi.host({
  list: ({ input, ctx }) => listSecretMetadata(input.cwd, ctx),
  reveal: ({ input, ctx }) => operationsFor(ctx).reveal(input.alias, input.scope, cwdForScope(input.scope, input.cwd), input.environment),
  copy: ({ input, ctx }) => operationsFor(ctx).copy(input.alias, input.scope, cwdForScope(input.scope, input.cwd), input.environment),
  machine: () => {
    const name = hostname()
    return { id: name, name }
  },
  create: ({ input, ctx }) => createCatalogSecret(input, ctx),
  update: ({ input, ctx }) => operationsFor(ctx).update({ ...input, cwd: cwdForScope(input.scope, input.cwd) }),
  removeAlias: ({ input, ctx }) => operationsFor(ctx).removeAlias(input.alias, input.scope, cwdForScope(input.scope, input.cwd)),
  deleteItem: ({ input, ctx }) => operationsFor(ctx).deleteItem(input.alias, input.scope, cwdForScope(input.scope, input.cwd), input.environment),
})

const setupApi = secretSetupApi.host({
  list: ({ input, ctx }) => listSecretMetadata(input.cwd, ctx),
  create: ({ input, ctx }) => createCatalogSecret(input, ctx),
})

let hostContext: Context | undefined

const tools = createSecretTools(() => {
  if (hostContext === undefined) throw new Error('Secret Catalog Host is not active.')
  return operationsFor(hostContext)
})

export default defineHost({
  name: 'secret-catalog',
  inject: ['connection', 'webServer', 'subprocess'],
  apis: [api, setupApi],
  tools,
  settings: [secretCatalogSettings],
  setup: ctx => {
    hostContext = ctx
    ctx.provide(
      'secretCatalogCredentials',
      createSecretCatalogCredentialBridge({
        operations: operationsFor(ctx),
        getCredentials: () => ctx.get('credentials'),
      }),
    )
    ctx.provide('secretCatalogValues', createSecretCatalogValues({ operations: operationsFor(ctx) }))
    ctx.effect(
      () => () => {
        if (hostContext === ctx) hostContext = undefined
      },
      'secret-catalog tools context',
    )
  },
})
