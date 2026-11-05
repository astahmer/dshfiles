import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpClient } from 'effect/http'
import { builtInProviderRegistry } from './provider-builtins.js'
import { ProviderCredentials } from './provider-credentials.js'
import { ExternalProviderEndpoints, type ExternalProviderEndpoint } from './provider-registry.js'
import type { BacklogSettings } from './settings.js'
import { BacklogSyncEngine } from './sync-engine.js'
import { SyncLocalProbes } from './sync-local-probes.js'
import { BacklogSync } from './sync-service.js'
import { SyncSources } from './sync-sources.js'
import { backlogStoreLayer, type BacklogTestRows } from './test-support.js'

export type LegacySyncRow = BacklogSettings['syncBackends'][number]

export const legacyLinearRow: LegacySyncRow = {
  project: '',
  backend: 'linear',
  enabled: true,
  target: 'ENG',
  secret: 'secret:LINEAR_KEY',
  autoSyncMinutes: 0,
  pushAgentComments: false,
}

export const legacyGithubRow: LegacySyncRow = {
  project: '',
  backend: 'github',
  enabled: true,
  target: 'acme/app',
  secret: 'secret:GITHUB_KEY',
  autoSyncMinutes: 0,
  pushAgentComments: false,
}

/**
 * The real sync stack (service, engine, SQLite sources, built-in providers, store) over a fake HTTP client. `rows` are
 * the legacy `syncBackends` settings the first open migrates; `secrets` answers each `secret:ALIAS` by alias.
 */
export const syncTestLayer = (input: {
  readonly client: HttpClient.HttpClient
  readonly rows?: readonly LegacySyncRow[]
  readonly secrets?: Readonly<Record<string, string>>
  readonly storage?: BacklogTestRows
  readonly probes?: { readonly repository?: string; readonly cliToken?: string }
  readonly external?: readonly ExternalProviderEndpoint[]
}) =>
  BacklogSync.layer.pipe(
    Layer.provideMerge(BacklogSyncEngine.layer),
    Layer.provideMerge(SyncSources.layer),
    Layer.provideMerge(builtInProviderRegistry),
    Layer.provideMerge(Layer.mergeAll(ProviderCredentials.layer, ExternalProviderEndpoints.layerTest(input.external ?? []))),
    Layer.provideMerge(
      Layer.mergeAll(
        backlogStoreLayer({ rows: input.storage, settings: { syncBackends: [...(input.rows ?? [])] } }),
        Layer.succeed(HttpClient.HttpClient, input.client),
        SecretReferenceResolver.layerTest({
          resolve: async request =>
            input.secrets?.[request.reference.alias] ?? (request.reference.alias.startsWith('GITHUB') ? 'gh_test_token' : 'lin_test_key'),
        }),
        SyncLocalProbes.layerTest(input.probes ?? {}),
        NodeFileSystem.layer,
        NodePath.layer,
      ),
    ),
  )
