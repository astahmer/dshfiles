import { describe, expect, it } from 'vitest'
import {
  activateGeneration,
  attemptGeneration,
  beginGenerationSwap,
  closeGeneration,
  closedGeneration,
  commitGenerationSwap,
  initialGenerationStore,
  isGenerationClosed,
  mountedGeneration,
  settleGenerationSwap,
} from '../src/host/generation-state.js'

const generation = (id: string) => ({ id })

describe('Host generation slot', () => {
  it('attempts each manifest revision once and never the mounted generation', () => {
    const store = activateGeneration(initialGenerationStore<{ id: string }>(), generation('gen-one'))
    expect(attemptGeneration(store, 'gen-one')).toBeUndefined()

    const recorded = attemptGeneration(store, 'gen-two')
    expect(recorded?.attempted).toEqual(['gen-two'])
    expect(mountedGeneration(recorded!)).toEqual(generation('gen-one'))
    expect(attemptGeneration(recorded!, 'gen-two')).toBeUndefined()
  })

  it('swaps through an empty slot: no generation is active until the candidate commits', () => {
    const mounted = activateGeneration(initialGenerationStore<{ id: string }>(), generation('gen-one'))
    const swapping = beginGenerationSwap(mounted, 'gen-two')
    expect(swapping.state).toEqual({ kind: 'swapping', previous: generation('gen-one'), candidate: 'gen-two' })
    expect(mountedGeneration(swapping)).toBeUndefined()
    expect(attemptGeneration(swapping, 'gen-three')).toBeUndefined()

    const committed = commitGenerationSwap(swapping, generation('gen-two'))
    expect(mountedGeneration(committed)).toEqual(generation('gen-two'))
    expect(committed.attempted).toEqual([])
  })

  it('settles a failed swap back to the previous generation or to failed with none', () => {
    const swapping = beginGenerationSwap(activateGeneration(initialGenerationStore<{ id: string }>(), generation('gen-one')), 'gen-two')
    expect(mountedGeneration(settleGenerationSwap(swapping, generation('gen-one')))).toEqual(generation('gen-one'))
    expect(settleGenerationSwap(swapping, undefined).state).toEqual({ kind: 'failed' })
    expect(mountedGeneration(settleGenerationSwap(swapping, undefined))).toBeUndefined()
  })

  it('keeps a closed slot terminal and remembers the generation its owner must unmount', () => {
    const active = activateGeneration(initialGenerationStore<{ id: string }>(), generation('gen-one'))
    const closed = closeGeneration(active)
    expect(isGenerationClosed(closed)).toBe(true)
    expect(closedGeneration(closed)).toEqual(generation('gen-one'))
    expect(mountedGeneration(closed)).toBeUndefined()
    expect(attemptGeneration(closed, 'gen-two')).toBeUndefined()
    expect(beginGenerationSwap(closed, 'gen-two')).toEqual(closed)
    expect(commitGenerationSwap(closed, generation('gen-two'))).toEqual(closed)
    expect(settleGenerationSwap(closed, generation('gen-one'))).toEqual(closed)
  })
})
