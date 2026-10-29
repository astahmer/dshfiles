/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type {} from '@dshfiles/session-controller/draft-client'
import { Service } from '@deepseek-ai/cordis'
import { createRegisteredApiClient } from '@dshfiles/dshx/client'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import { ModelCatalogDirectory } from './catalog.ts'
import { ModelDirectory } from './directory.ts'

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Directories keyed by Client binding, removed by their scope disposer. */
  readonly directories: WeakMapWithValues<SessionBinding, ModelDirectory>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['sessions', 'sessionDrafts', 'remote', 'remote.session', 'remote.commands']

  private readonly live: LiveState = { directories: new WeakMapWithValues() }
  private readonly catalog: ModelCatalogDirectory
  private readonly handoff: ReturnType<typeof createRegisteredApiClient>

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   */
  constructor(ctx: Context) {
    super(ctx, 'modelDirectories')
    this.handoff = createRegisteredApiClient(ctx, {
      owner: '@dshfiles/model-effort-picker',
      id: 'model-handoff',
      version: 1,
      methods: ['contextWindow'],
    })
    this.catalog = new ModelCatalogDirectory(ctx)
    void this.catalog.load().catch(() => { /* selectors expose the shared error */ })
    ctx.on('connection/reset', () => {
      this.catalog.resetGeneration()
      for (const directory of this.live.directories.values) directory.resetConnected()
    })
    ctx.remote.$on('llm/adapters-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('settings/document-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/record-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/reference-updated', () => { this.catalog.refresh() })
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  private async resolveContextWindow(route: Pick<ModelSelection, 'provider' | 'model'>): Promise<number | null> {
    const contextWindow = this.handoff.safe.contextWindow
    if (contextWindow === undefined) return null
    const result = await contextWindow(route)
    if (!result.ok) return null
    const decoded = z.number().int().positive().nullable().safeParse(result.value)
    return decoded.success ? decoded.data : null
  }

  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
    const existing = live.directories.get(binding)
    if (existing !== undefined) return existing
    const directory = new ModelDirectory(
      this.ctx.remote.session,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
      this.catalog,
      binding.session.projections.faceOf('modelSelection'),
      binding.session.projections.faceOf('contextPressure'),
      () => binding.session.getSnapshot().blank,
      route => this.resolveContextWindow(route),
      async () => {
        const result = await this.ctx.remote.commands.execute(sessionId, '/compact', [])
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (result.value === undefined) return false
        if (result.value.result.kind === 'error') throw new Error(result.value.result.text ?? 'Compaction failed.')
        return true
      },
      (name, attributes) => this.ctx.get('productAnalytics')?.track(name, attributes),
      this.ctx.sessionDrafts,
    )
    live.directories.set(binding, directory)
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(binding)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
