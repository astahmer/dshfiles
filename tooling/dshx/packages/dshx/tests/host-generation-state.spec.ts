import { describe, expect, it } from 'vitest'
import { HostGenerationStateModel } from '../src/host/generation-state.js'

const generation = (id: string) => ({ id })

describe('Host generation slot', () => {
  it('attempts each manifest revision once and never the mounted generation', () => {
    const store = HostGenerationStateModel.activateGeneration(HostGenerationStateModel.initialGenerationStore<{ id: string }>(), generation('gen-one'))
    expect(HostGenerationStateModel.attemptGeneration(store, 'gen-one')).toBeUndefined()

    const recorded = HostGenerationStateModel.attemptGeneration(store, 'gen-two')
    expect(recorded?.attempted).toEqual(['gen-two'])
    expect(HostGenerationStateModel.mountedGeneration(recorded!)).toEqual(generation('gen-one'))
    expect(HostGenerationStateModel.attemptGeneration(recorded!, 'gen-two')).toBeUndefined()
  })

  it('swaps through an empty slot: no generation is active until the candidate commits', () => {
    const mounted = HostGenerationStateModel.activateGeneration(HostGenerationStateModel.initialGenerationStore<{ id: string }>(), generation('gen-one'))
    const swapping = HostGenerationStateModel.beginGenerationSwap(mounted, 'gen-two')
    expect(swapping.state).toEqual({ kind: 'swapping', previous: generation('gen-one'), candidate: 'gen-two' })
    expect(HostGenerationStateModel.mountedGeneration(swapping)).toBeUndefined()
    expect(HostGenerationStateModel.attemptGeneration(swapping, 'gen-three')).toBeUndefined()

    const committed = HostGenerationStateModel.commitGenerationSwap(swapping, generation('gen-two'))
    expect(HostGenerationStateModel.mountedGeneration(committed)).toEqual(generation('gen-two'))
    expect(committed.attempted).toEqual([])
  })

  it('settles a failed swap back to the previous generation or to failed with none', () => {
    const swapping = HostGenerationStateModel.beginGenerationSwap(
      HostGenerationStateModel.activateGeneration(HostGenerationStateModel.initialGenerationStore<{ id: string }>(), generation('gen-one')),
      'gen-two',
    )
    expect(HostGenerationStateModel.mountedGeneration(HostGenerationStateModel.settleGenerationSwap(swapping, generation('gen-one')))).toEqual(
      generation('gen-one'),
    )
    expect(HostGenerationStateModel.settleGenerationSwap(swapping, undefined).state).toEqual({ kind: 'failed' })
    expect(HostGenerationStateModel.mountedGeneration(HostGenerationStateModel.settleGenerationSwap(swapping, undefined))).toBeUndefined()
  })

  it('keeps a closed slot terminal and remembers the generation its owner must unmount', () => {
    const active = HostGenerationStateModel.activateGeneration(HostGenerationStateModel.initialGenerationStore<{ id: string }>(), generation('gen-one'))
    const closed = HostGenerationStateModel.closeGeneration(active)
    expect(HostGenerationStateModel.isGenerationClosed(closed)).toBe(true)
    expect(HostGenerationStateModel.closedGeneration(closed)).toEqual(generation('gen-one'))
    expect(HostGenerationStateModel.mountedGeneration(closed)).toBeUndefined()
    expect(HostGenerationStateModel.attemptGeneration(closed, 'gen-two')).toBeUndefined()
    expect(HostGenerationStateModel.beginGenerationSwap(closed, 'gen-two')).toEqual(closed)
    expect(HostGenerationStateModel.commitGenerationSwap(closed, generation('gen-two'))).toEqual(closed)
    expect(HostGenerationStateModel.settleGenerationSwap(closed, generation('gen-one'))).toEqual(closed)
  })
})
