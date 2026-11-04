import { settingsShellSettings } from '@dshfiles/settings-shell/settings'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Jev } from '@dshfiles/jev'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { AgentScopes } from './agent-scopes.ts'
import { Digester } from './digester.ts'
import { Embedder } from './embedder.ts'
import { Maintenance } from './maintenance.ts'
import { MemoryDb } from './memory-db.ts'
import { MemoryJev } from './memory-jev.ts'
import { MemoryRepo } from './memory-repo.ts'
import { DigestPricing } from './pricing-promise.ts'
import { ProjectPaths } from './project-path.ts'
import { PromptHook } from './prompt-hook-promise.ts'
import { Recall } from './recall.ts'
import { SessionActivity } from './session-activity.ts'
import { SessionReads } from './session-reads-promise.ts'
import { memorySettings } from './settings.ts'
import { Summarizer } from './summarizer-promise.ts'
import { WorkspaceScripts } from './workspace-scripts.ts'

/**
 * Memory's own services over one SQLite file. They need the external edges (`SessionReads`, `Summarizer`,
 * `AgentScopes`, `Jev`), settings, secrets, `HostContext` for Session events, and the platform file system.
 */
export const memoryServices = (filename: string) =>
  Layer.mergeAll(Recall.layer, DigestPricing.layer, WorkspaceScripts.layer()).pipe(
    Layer.provideMerge(SessionActivity.layer),
    Layer.provideMerge(Digester.layer),
    Layer.provideMerge(Layer.mergeAll(MemoryJev.layer, Embedder.layer, ProjectPaths.layer)),
    Layer.provideMerge(MemoryRepo.layer),
    Layer.provideMerge(MemoryDb.layer(filename)),
  )

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** The Host services memory reads through dshx, and the edges that adapt DSH's Promise services and TypeSafe. */
const hostEdges = Layer.mergeAll(Summarizer.layer, AgentScopes.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(SessionReads.layer, Jev.layer)),
  Layer.provideMerge(Layer.mergeAll(Settings.layer(memorySettings), Settings.layer(settingsShellSettings), HostApis.layer, SecretReferenceResolver.layer, Llm.layer, FetchHttpClient.layer, platform)),
)

/** Every memory service and background loop of one activation. */
export const memoryLayer = (filename: string) =>
  Layer.mergeAll(PromptHook, Maintenance).pipe(Layer.provideMerge(memoryServices(filename)), Layer.provideMerge(hostEdges))
