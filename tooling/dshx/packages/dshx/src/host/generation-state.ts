/**
 * One Host HMR generation slot. The union is the only authority on which generation is live: `swapping` never
 * claims a generation while the previous one is unmounted and the candidate has not started.
 */
export type HostGenerationState<Mounted extends { readonly id: string }> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'active'; readonly generation: Mounted }
  | { readonly kind: 'swapping'; readonly previous: Mounted | undefined; readonly candidate: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'closed'; readonly generation: Mounted | undefined }

export interface HostGenerationStore<Mounted extends { readonly id: string }> {
  readonly state: HostGenerationState<Mounted>
  readonly attempted: readonly string[]
}

export class HostGenerationStateModel {
  static initialGenerationStore = <Mounted extends { readonly id: string }>(): HostGenerationStore<Mounted> => ({
    state: { kind: 'idle' },
    attempted: [],
  })

  static mountedGeneration = <Mounted extends { readonly id: string }>(store: HostGenerationStore<Mounted>): Mounted | undefined =>
    store.state.kind === 'active' ? store.state.generation : undefined

  static isGenerationClosed = <Mounted extends { readonly id: string }>(store: HostGenerationStore<Mounted>): boolean => store.state.kind === 'closed'

  /** One attempt per revision: a rejected, failed or current generation is not retried until the manifest changes. */
  static attemptGeneration = <Mounted extends { readonly id: string }>(
    store: HostGenerationStore<Mounted>,
    candidate: string,
  ): HostGenerationStore<Mounted> | undefined => {
    if (store.state.kind === 'closed' || store.state.kind === 'swapping') return undefined
    if (HostGenerationStateModel.mountedGeneration(store)?.id === candidate || store.attempted.includes(candidate)) return undefined
    return { state: store.state, attempted: [...store.attempted, candidate] }
  }

  static activateGeneration = <Mounted extends { readonly id: string }>(
    store: HostGenerationStore<Mounted>,
    generation: Mounted,
  ): HostGenerationStore<Mounted> => ({ state: { kind: 'active', generation }, attempted: store.attempted })

  static beginGenerationSwap = <Mounted extends { readonly id: string }>(
    store: HostGenerationStore<Mounted>,
    candidate: string,
  ): HostGenerationStore<Mounted> => {
    if (store.state.kind === 'closed' || store.state.kind === 'swapping') return store
    return {
      state: { kind: 'swapping', previous: HostGenerationStateModel.mountedGeneration(store), candidate },
      attempted: store.attempted,
    }
  }

  static commitGenerationSwap = <Mounted extends { readonly id: string }>(
    store: HostGenerationStore<Mounted>,
    generation: Mounted,
  ): HostGenerationStore<Mounted> => (store.state.kind === 'swapping' ? { state: { kind: 'active', generation }, attempted: store.attempted } : store)

  /** Settle a finished swap: the restored previous generation, or `failed` when nothing is mounted any more. */
  static settleGenerationSwap = <Mounted extends { readonly id: string }>(
    store: HostGenerationStore<Mounted>,
    restored: Mounted | undefined,
  ): HostGenerationStore<Mounted> => {
    if (store.state.kind !== 'swapping') return store
    return {
      state: restored === undefined ? { kind: 'failed' } : { kind: 'active', generation: restored },
      attempted: store.attempted,
    }
  }

  static closeGeneration = <Mounted extends { readonly id: string }>(store: HostGenerationStore<Mounted>): HostGenerationStore<Mounted> => ({
    state: { kind: 'closed', generation: HostGenerationStateModel.mountedGeneration(store) },
    attempted: store.attempted,
  })

  /** The generation a closed store still has to unmount, captured before the queue drains. */
  static closedGeneration = <Mounted extends { readonly id: string }>(store: HostGenerationStore<Mounted>): Mounted | undefined =>
    store.state.kind === 'closed' ? store.state.generation : undefined
}
