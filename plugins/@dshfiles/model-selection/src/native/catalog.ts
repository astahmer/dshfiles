/** One Host-generation model catalog shared by every Session selector. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelCatalog, ModelSelection, ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { joinPageRead } from '@dshfiles/dshx/client'

/** Observable lifecycle of the shared model catalog. */
export interface ModelCatalogState {
  value: ModelCatalog | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
}

const CATALOG_REFRESH_QUIET_MS = 50
const CATALOG_REFRESH_MAX_WAIT_MS = 250
const CATALOG_REFRESH_MIN_INTERVAL_MS = 1_000

/** Page-wide key: the native Models settings store reads the same catalog in the same Host event bursts. */
const MODEL_CATALOG_READ = 'remote:session/modelCatalog'

/** Loads at most one model catalog for the current Host generation. */
export class ModelCatalogDirectory {
  /** Current shared catalog value and load lifecycle. */
  readonly store: SnapshotStore<ModelCatalogState> = createSnapshotStore({
    value: null,
    status: 'idle',
    error: null,
  })

  private readonly reasoning = new Map<string, ModelProviderGroup['models'][number]['reasoning']>()

  /**
   * Read the last advertised reasoning metadata, including unavailable models.
   * @param selection - provider and model whose effort is displayed.
   * @returns reasoning metadata observed during this Host generation.
   */
  reasoningFor(selection: ModelSelection): ModelProviderGroup['models'][number]['reasoning'] {
    return this.reasoning.get(JSON.stringify([selection.provider, selection.model]))
  }

  private generation = 0
  private inflight: Promise<ModelCatalog> | undefined
  /** `performance.now()` of the last Host change: a shared read that started earlier may predate it. */
  private changedAt = Number.NEGATIVE_INFINITY

  /**
   * @param ctx - the providing plugin's context, whose `remote.session`
   * namespace carries the Host-generation catalog.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Return the current generation's catalog, sharing its one in-flight load.
   * @returns the loaded global catalog.
   */
  load(): Promise<ModelCatalog> {
    const state = this.store.getSnapshot()
    if (state.status === 'ready' && state.value !== null) return Promise.resolve(state.value)
    if (this.inflight !== undefined) return this.inflight
    const generation = this.generation
    this.store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    const operation = joinPageRead({
      key: MODEL_CATALOG_READ,
      read: () => this.ctx.remote.session.modelCatalog(),
      notBefore: this.changedAt,
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      if (generation === this.generation) {
        for (const group of response.value.groups) {
          for (const model of group.models) {
            this.reasoning.set(JSON.stringify([group.id, model.id]), model.reasoning)
          }
        }
        this.store.set({ value: response.value, status: 'ready', error: null })
      }
      return response.value
    }).catch((error: unknown) => {
      if (generation === this.generation) {
        this.store.update((draft) => {
          draft.status = 'error'
          draft.error = error instanceof Error ? error.message : String(error)
        })
      }
      throw error
    }).finally(() => {
      if (generation === this.generation && this.inflight === operation) this.inflight = undefined
    })
    this.inflight = operation
    return operation
  }

  /**
   * Invalidate the loaded catalog; the next explicit menu read reloads it.
   * @param clear - whether values from the previous Host generation must be hidden.
   */
  private invalidate(clear = false): void {
    this.generation += 1
    this.inflight = undefined
    const value = clear ? null : this.store.getSnapshot().value
    this.store.set({ value, status: 'idle', error: null })
  }

  /** Invalidate and reload the catalog after a Host-side model input changes. */
  refresh(): void {
    this.lastRefreshAt = performance.now()
    this.invalidate()
    void this.load().catch(() => { /* the selector exposes the shared error */ })
  }

  private pendingRefresh: ReturnType<typeof setTimeout> | undefined
  private burstStartedAt: number | undefined
  private lastRefreshAt = Number.NEGATIVE_INFINITY

  /**
   * Refresh once for a burst of Host change events. One settings or credential write announces several events,
   * spread over more than 50 ms on a busy page; refreshing on each started one `session/modelCatalog` read per event.
   * The read waits until the burst is quiet for 50 ms, and at most 250 ms after it began. A thread switch fires
   * several such bursts within a second, each costing a full Host catalog rebuild, so reads start at most once per
   * second; the deferred read still starts after the last event, so a changed catalog always shows up.
   */
  scheduleRefresh(): void {
    const now = performance.now()
    this.changedAt = now
    this.burstStartedAt ??= now
    if (this.pendingRefresh !== undefined) clearTimeout(this.pendingRefresh)
    const burstDelay = Math.min(CATALOG_REFRESH_QUIET_MS, this.burstStartedAt + CATALOG_REFRESH_MAX_WAIT_MS - now)
    const delay = Math.max(0, burstDelay, this.lastRefreshAt + CATALOG_REFRESH_MIN_INTERVAL_MS - now)
    this.pendingRefresh = setTimeout(() => {
      this.pendingRefresh = undefined
      this.burstStartedAt = undefined
      this.refresh()
    }, delay)
  }

  private cancelScheduledRefresh(): void {
    if (this.pendingRefresh === undefined) return
    clearTimeout(this.pendingRefresh)
    this.pendingRefresh = undefined
    this.burstStartedAt = undefined
  }

  /** Clear Host-specific values and load the replacement Host generation. */
  resetGeneration(): void {
    this.cancelScheduledRefresh()
    this.changedAt = performance.now()
    this.reasoning.clear()
    this.invalidate(true)
    void this.load().catch(() => { /* the selector exposes the shared error */ })
  }
}
