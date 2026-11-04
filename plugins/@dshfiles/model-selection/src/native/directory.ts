/**
 * Per-session model directory: the ONE state both selection entries share.
 * The /model popup and composer seat combine one shared Host catalog with the
 * Session's durable selection projection, then submit through the same
 * selectModel call. A switch made in either entry updates this shared state.
 */
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import type {
  ModelCatalogFailure, ModelProviderGroup, ModelSelection, ModelSelectionProjection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-commands/remote'
import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { z } from 'zod'
import type { ModelCatalogDirectory } from './catalog.ts'
import type { SessionDrafts } from '@dshfiles/session-controller/draft-client'

/** Directory snapshot both entries render from. */
export interface ModelDirectoryState {
  /** Saved selection, retained even when its provider or model leaves the catalog. */
  current: ModelSelection | null
  /** Saved effort caption retained when the selected model is unavailable. */
  retainedEffort?: string
  /** Whether the current selection is present in the available catalog; null while unresolved. */
  routable: boolean | null
  /** Successfully loaded provider groups (last good load). */
  groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Selection submitted by the latest `select` until it settles; null otherwise. */
  pending: ModelSelection | null
  /** Whole-request or selection failure text; null when none. */
  error: string | null
}

/** One session's shared directory controller; disposed with the session scope. */
export class ModelDirectory {
  static shouldCompactForHandoff = (input: {
    readonly current: ModelSelection | null
    readonly target: ModelSelection
    readonly pressure: Pick<ContextPressureProjection, 'contextWindow' | 'projectedTokens'> | undefined
    readonly currentContextWindow: number | null
    readonly targetContextWindow: number | null
  }): boolean => {
    if (
      input.current === null ||
      (input.current.provider === input.target.provider && input.current.model === input.target.model) ||
      input.currentContextWindow === null ||
      input.targetContextWindow === null ||
      input.targetContextWindow >= input.currentContextWindow ||
      input.pressure?.contextWindow !== input.currentContextWindow ||
      input.pressure.projectedTokens === undefined
    )
      return false
    return input.pressure.projectedTokens >= input.targetContextWindow * 0.8
  }

  /** The shared snapshot both entries render from (uSES-safe store). */
  readonly store: SnapshotStore<ModelDirectoryState> = createSnapshotStore<ModelDirectoryState>({
        current: null,
    routable: null,
    groups: [], failures: [], status: 'idle', pending: null, error: null,
  })

  /** Latest selection operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false
  private readonly contextPressureSchema = z.object({
    pressureTokens: z.number().optional(),
    projectedTokens: z.number().optional(),
    contextWindow: z.number().optional(),
  })
  private readonly unsubscribeCatalog: () => void
  private readonly unsubscribeSelection: () => void
  private readonly unsubscribePressure: () => void
  private readonly unsubscribeDrafts: (() => void) | undefined

  /**
   * @param sessions - the session wire face (captured from the plugin's root connection).
   * @param sessionId - the owning session.
   * @param available - whether this session may use Agent-bound model RPCs.
   * @param catalog - Host-generation catalog shared by every Session.
   * @param projected - durable model selection projected from Session history.
   * @param isBlank - whether this Session has no first message yet.
   * @param track - desktop-only callback after a successful user selection.
   */
  constructor(
    private readonly sessions: Pick<TypertClientRemote['session'], 'selectModel'>,
    private readonly sessionId: SessionId,
    private readonly available: () => boolean,
    private readonly catalog: ModelCatalogDirectory,
    private readonly projected: ObservableSnapshot<unknown>,
    private readonly pressure: ObservableSnapshot<unknown>,
    private readonly isBlank: () => boolean,
    private readonly resolveContextWindow: (route: Pick<ModelSelection, 'provider' | 'model'>) => Promise<number | null>,
    private readonly compact: () => Promise<boolean>,
    private readonly track?: TrackProductEvent,
    private readonly drafts?: SessionDrafts,
  ) {
    this.unsubscribeCatalog = catalog.store.subscribe(() => { this.syncInputs() })
    this.unsubscribeSelection = projected.subscribe(() => { this.syncInputs() })
    this.unsubscribePressure = pressure.subscribe(() => { this.syncInputs() })
    this.unsubscribeDrafts = drafts?.list.subscribe(() => { this.syncInputs() })
    this.syncInputs()
  }

  /**
   * Ensure the Host generation's shared available catalog is loaded.
   * @returns the fresh directory value.
   */
  async load(): Promise<ModelDirectoryState> {
    this.assertAvailable()
    await this.catalog.load()
    this.syncInputs()
    return this.store.getSnapshot()
  }

  /**
   * Select the complete provider/model/reasoning selection. The durable
   * projection frame updates the shared current; failures surface on the store
   * and return with the operation so each entry can present its own failure.
   * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
   * @returns the selection outcome, including the original Remote failure.
   */
  async select(selection: ModelSelection): Promise<RemoteResult<void>> {
    this.assertAvailable()
    // The draft owner decides whether this identity exists on the Host. Never
    // send an Agent-bound RPC merely to configure a client-only blank.
    if (this.drafts?.stageModel(this.sessionId, selection)) {
      ++this.generation
      this.store.update((state) => { state.status = 'ready'; state.pending = null; state.error = null })
      this.syncInputs()
      return { ok: true, value: undefined }
    }
    const previous = this.store.getSnapshot().current
    const pressure = this.readContextPressure()
    const previousEffort = previous?.reasoningEffort ?? (previous === null ? undefined : this.catalog.reasoningFor(previous)?.defaultEffort)
    const nextEffort = selection.reasoningEffort ?? this.catalog.reasoningFor(selection)?.defaultEffort
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'selecting'; state.pending = selection; state.error = null })
    try {
      const routeChanged = previous !== null && (previous.provider !== selection.provider || previous.model !== selection.model)
      if (routeChanged && previous !== null && pressure !== undefined) {
        const [currentContextWindow, targetContextWindow] = await Promise.all([
          this.resolveContextWindow({ provider: previous.provider, model: previous.model }).catch(() => null),
          this.resolveContextWindow({ provider: selection.provider, model: selection.model }).catch(() => null),
        ])
        if (this.disposed || generation !== this.generation) return { ok: true, value: undefined }
        if (ModelDirectory.shouldCompactForHandoff({ current: previous, target: selection, pressure, currentContextWindow, targetContextWindow })) {
          await this.compact()
        }
      }
      if (this.disposed || generation !== this.generation) return { ok: true, value: undefined }
      const result = await this.sessions.selectModel({
        sessionId: this.sessionId,
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selection.reasoningEffort },
      })
      if (this.disposed || generation !== this.generation) {
        return result.ok ? { ok: true, value: undefined } : result
      }
      if (!result.ok) {
        this.store.update((state) => {
          state.status = 'error'
          state.pending = null
          state.error = `${result.error.code}: ${result.error.message}`
        })
        return result
      }
      if (previous !== null) {
        const from = `${previous.provider}/${previous.model}`
        const to = `${selection.provider}/${selection.model}`
        if (from !== to) this.track?.('model_switch', { ...this.isBlank() ? {} : { session_id: this.sessionId }, switch_from: from, switch_to: to })
        if (from === to && previousEffort !== nextEffort) this.track?.('thinking_level_switch', {
          ...this.isBlank() ? {} : { session_id: this.sessionId }, model_name: to, switch_from: previousEffort ?? 'default', switch_to: nextEffort ?? 'default',
        })
      }
      this.store.update((state) => { state.status = 'ready'; state.pending = null; state.error = null })
      this.syncInputs()
      return { ok: true, value: undefined }
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.store.update((state) => {
          state.status = 'error'
          state.pending = null
          state.error = error instanceof Error ? error.message : String(error)
        })
      }
      throw error
    }
  }

  /**
   * Invalidate an in-flight selection response from the previous Host generation.
   */
  resetConnected(): void {
    if (this.disposed) return
    ++this.generation
    this.store.update((state) => {
      if (state.status === 'selecting') state.status = 'idle'
      state.pending = null
      state.error = null
    })
    this.syncInputs()
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
    this.unsubscribeSelection()
    this.unsubscribePressure()
    this.unsubscribeCatalog()
    this.unsubscribeDrafts?.()
  }

  private readContextPressure(): ContextPressureProjection | undefined {
    const value = this.pressure.getSnapshot()
    if (value === undefined) return undefined
    const decoded = this.contextPressureSchema.safeParse(value)
    if (!decoded.success) return undefined
    return {
      ...(decoded.data.pressureTokens === undefined ? {} : { pressureTokens: decoded.data.pressureTokens }),
      ...(decoded.data.projectedTokens === undefined ? {} : { projectedTokens: decoded.data.projectedTokens }),
      ...(decoded.data.contextWindow === undefined ? {} : { contextWindow: decoded.data.contextWindow }),
    }
  }

  private assertAvailable(): void {
    if (!this.available()) {
      throw new Error('model selection is unavailable for addressed subagent sessions')
    }
  }

  private syncInputs(): void {
    if (this.disposed) return
    const catalog = this.catalog.store.getSnapshot()
    const projected = modelSelectionProjection(this.projected.getSnapshot())
    const draft = this.drafts?.list.getSnapshot()[this.sessionId]
    const local = draft?.local === true
    const intended = (local ? draft.model : projected?.next) ?? catalog.value?.default
    const reasoning = intended === undefined ? undefined : this.catalog.reasoningFor(intended)
    const effort = intended?.reasoningEffort ?? reasoning?.defaultEffort
    const retainedEffort = effort === undefined ? undefined
      : reasoning?.efforts.find(level => level.id === effort)?.name ?? effort
    if (catalog.status !== 'ready' || catalog.value === null || (!local && projected === undefined)) {
      this.store.set({
        current: local ? intended ?? this.store.getSnapshot().current
          : catalog.value === null ? null : this.store.getSnapshot().current,
        ...retainedEffort === undefined ? {} : { retainedEffort },
        routable: null,
        groups: catalog.value?.groups ?? [],
        failures: catalog.value?.failures ?? [],
        status: catalog.status === 'error' ? 'error' : 'loading',
        pending: this.store.getSnapshot().pending,
        error: catalog.error,
      })
      return
    }
    const selection = intended ?? catalog.value.default
    const routable = catalog.value.groups.some(group => group.id === selection.provider
      && group.models.some(model => model.id === selection.model))
    this.store.set({
      current: selection,
      ...retainedEffort === undefined ? {} : { retainedEffort },
      routable,
      groups: catalog.value.groups,
      failures: catalog.value.failures,
      status: this.store.getSnapshot().status === 'selecting'
        ? 'selecting'
        : 'ready',
      pending: this.store.getSnapshot().pending,
      error: null,
    })
  }
}

function modelSelectionProjection(value: unknown): ModelSelectionProjection | undefined {
  return value === undefined ? undefined : value as ModelSelectionProjection
}
