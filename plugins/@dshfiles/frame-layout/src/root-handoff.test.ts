import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerRootAcrossReloads } from './root-handoff.js'

afterEach(() => {
  vi.useRealTimers()
  globalThis.__dshfilesFrameRootPlaceholder?.()
  globalThis.__dshfilesFrameRootPlaceholder = undefined
})

const rootSlot = () => {
  const live: string[] = []
  const register = (name: string) => () => {
    live.push(name)
    return () => live.splice(live.indexOf(name), 1)
  }
  return { live, frame: (name: string) => ({ register: register(name), placeholder: register('placeholder') }) }
}

describe('registerRootAcrossReloads', () => {
  it('keeps root registered between the old frame leaving and the reloaded frame registering', () => {
    const root = rootSlot()
    const disposeOld = registerRootAcrossReloads(root.frame('old'))
    disposeOld()
    expect(root.live).toEqual(['placeholder'])
    const disposeNew = registerRootAcrossReloads(root.frame('new'))
    expect(root.live).toEqual(['new'])
    disposeNew()
    registerRootAcrossReloads(root.frame('newer'))
    expect(root.live).toEqual(['newer'])
  })

  it('removes the placeholder when no frame follows once the grace ends', () => {
    vi.useFakeTimers()
    const root = rootSlot()
    registerRootAcrossReloads(root.frame('only'))()
    expect(root.live).toEqual(['placeholder'])
    vi.advanceTimersByTime(3_000)
    expect(root.live).toEqual([])
  })
})
