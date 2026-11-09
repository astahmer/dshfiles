import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'

type RemoteModelCatalog = Pick<ModelDirectoryState, 'groups' | 'failures'>

type CatalogState =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'ready'; readonly catalog: RemoteModelCatalog }
  | { readonly kind: 'error'; readonly error: string }

const initialState = (base: ModelDirectoryState): ModelDirectoryState => ({
  ...base,
  groups: [],
  failures: [],
  status: 'idle',
  error: null,
})

const createRemoteStore = (initial: ModelDirectoryState): SnapshotStore<ModelDirectoryState> => {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: next => {
      snapshot = next
      notify()
    },
    update: mutator => {
      const next = { ...snapshot }
      mutator(next)
      snapshot = next
      notify()
    },
  }
}

const CATALOG_FRESH_MS = 30_000

export class RemoteModelDirectory {
  readonly store: SnapshotStore<ModelDirectoryState>
  private catalog: RemoteModelCatalog | undefined
  /** Remote catalog load, kept apart from the base selection so neither overwrites the other's status. */
  private catalogState: CatalogState = { kind: 'idle' }
  private generation = 0
  private loadedAt = Number.NEGATIVE_INFINITY
  private readonly unsubscribe: () => void

  constructor(
    private readonly base: Pick<ModelDirectory, 'store' | 'select'>,
    private readonly fetchCatalog: () => Promise<RemoteModelCatalog>,
  ) {
    this.store = createRemoteStore(initialState(base.store.getSnapshot()))
    this.unsubscribe = base.store.subscribe(() => this.syncSelection())
  }

  readonly load = async (): Promise<ModelDirectoryState> => {
    // The picker loads on every composer mount, i.e. every thread switch; a recent catalog answers it without a request.
    if (this.catalogState.kind === 'ready' && performance.now() - this.loadedAt < CATALOG_FRESH_MS) return this.store.getSnapshot()
    const generation = ++this.generation
    this.setCatalogState({ kind: 'loading' })
    try {
      const catalog = await this.fetchCatalog()
      if (generation !== this.generation) return this.store.getSnapshot()
      this.catalog = catalog
      this.loadedAt = performance.now()
      this.setCatalogState({ kind: 'ready', catalog })
    } catch (error) {
      if (generation !== this.generation) return this.store.getSnapshot()
      this.setCatalogState({ kind: 'error', error: error instanceof Error ? error.message : String(error) })
    }
    return this.store.getSnapshot()
  }

  readonly select: ModelSelectInjected['select'] = async (selection: ModelSelection) => {
    const result = await this.base.select(selection)
    if (result !== undefined && !result.ok) return result
    this.store.update(state => {
      state.current = selection
      state.pending = null
      state.routable = this.isRoutable(selection)
      this.applyStatus(state, { selecting: false, selectionError: null })
    })
    return result
  }

  dispose(): void {
    this.generation += 1
    this.unsubscribe()
  }

  private setCatalogState(catalogState: CatalogState): void {
    this.catalogState = catalogState
    const selection = this.base.store.getSnapshot()
    this.store.update(state => {
      if (catalogState.kind === 'ready') {
        state.groups = catalogState.catalog.groups
        state.failures = catalogState.catalog.failures
        state.routable = this.isRoutable(state.current)
      }
      this.applyStatus(state, {
        selecting: selection.status === 'selecting',
        selectionError: selection.status === 'error' ? selection.error : null,
      })
    })
  }

  private syncSelection(): void {
    const selection = this.base.store.getSnapshot()
    this.store.update(state => {
      state.current = selection.current
      if (selection.retainedEffort === undefined) delete state.retainedEffort
      else state.retainedEffort = selection.retainedEffort
      state.pending = selection.pending
      if (state.current !== null && this.catalog !== undefined) state.routable = this.isRoutable(state.current)
      this.applyStatus(state, {
        selecting: selection.status === 'selecting',
        selectionError: selection.status === 'error' ? selection.error : null,
      })
    })
  }

  /** The combined status: a selection in flight or failed wins over the remote catalog's own load state. */
  private applyStatus(state: ModelDirectoryState, selection: { readonly selecting: boolean; readonly selectionError: string | null }): void {
    const catalogError = this.catalogState.kind === 'error' ? this.catalogState.error : null
    state.error = selection.selectionError ?? catalogError
    if (selection.selecting) state.status = 'selecting'
    else if (state.error !== null) state.status = 'error'
    else state.status = this.catalogState.kind
  }

  private isRoutable(selection: ModelSelection | null): boolean {
    return (
      selection !== null &&
      (this.catalog?.groups.some(group => group.id === selection.provider && group.models.some(model => model.id === selection.model)) ?? false)
    )
  }
}
