import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'

type RemoteModelCatalog = Pick<ModelDirectoryState, 'groups' | 'failures'>

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

export class RemoteModelDirectory {
  readonly store: SnapshotStore<ModelDirectoryState>
  private catalog: RemoteModelCatalog | undefined
  private generation = 0
  private readonly unsubscribe: () => void

  constructor(
    private readonly base: ModelDirectory,
    private readonly fetchCatalog: () => Promise<RemoteModelCatalog>,
  ) {
    this.store = createRemoteStore(initialState(base.store.getSnapshot()))
    this.unsubscribe = base.store.subscribe(() => this.syncSelection())
  }

  readonly load = async (): Promise<ModelDirectoryState> => {
    const generation = ++this.generation
    this.store.update(state => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const catalog = await this.fetchCatalog()
      if (generation !== this.generation) return this.store.getSnapshot()
      this.catalog = catalog
      this.store.update(state => {
        state.groups = catalog.groups
        state.failures = catalog.failures
        state.status = 'ready'
        state.error = null
        state.routable = catalog.groups.some(group => group.id === state.current?.provider && group.models.some(model => model.id === state.current?.model))
      })
    } catch (error) {
      if (generation !== this.generation) return this.store.getSnapshot()
      this.store.update(state => {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
    return this.store.getSnapshot()
  }

  readonly select: ModelSelectInjected['select'] = async (selection: ModelSelection) => {
    const result = await this.base.select(selection)
    if (result !== undefined && !result.ok) return result
    this.store.update(state => {
      state.current = selection
      state.pending = null
      state.status = 'ready'
      state.error = null
      state.routable = this.isRoutable(selection)
    })
    return result
  }

  dispose(): void {
    this.generation += 1
    this.unsubscribe()
  }

  private syncSelection(): void {
    const selection = this.base.store.getSnapshot()
    this.store.update(state => {
      state.current = selection.current
      if (selection.retainedEffort === undefined) delete state.retainedEffort
      else state.retainedEffort = selection.retainedEffort
      state.pending = selection.pending
      if (selection.status === 'selecting' || selection.status === 'error') state.status = selection.status
      else if (state.status === 'selecting') state.status = 'ready'
      if (selection.error !== null) state.error = selection.error
      if (state.current !== null && this.catalog !== undefined) state.routable = this.isRoutable(state.current)
    })
  }

  private isRoutable(selection: ModelSelection | null): boolean {
    return selection !== null && (this.catalog?.groups.some(group => group.id === selection.provider && group.models.some(model => model.id === selection.model)) ?? false)
  }
}
