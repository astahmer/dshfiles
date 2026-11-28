import type { PaletteAction } from '@dshfiles/command-palette/palette-contract'
import type { PluginContext } from '@dshfiles/dshx/client'
import { describe, expect, it, vi } from 'vitest'
import { PaletteBridge } from './palette-bridge.js'

const actions = (count: number): PaletteAction[] => Array.from({ length: count }, (_, index) => ({ id: `@dshfiles/thread-sidebar/test/${String(index)}`, label: `Row ${String(index)}`, run: () => undefined }))

/** The parts of a plugin context the bridge uses; each add counts as one registry publish. */
const fakePlugin = (options: { readonly batched: boolean }) => {
  const publishes = { count: 0 }
  const remove = () => {
    publishes.count += 1
  }
  const add = vi.fn(() => {
    publishes.count += 1
    return remove
  })
  const addAll = vi.fn(() => {
    publishes.count += 1
    return remove
  })
  const plugin: Pick<PluginContext, 'add'> & Partial<Pick<PluginContext, 'addAll'>> = options.batched ? { add, addAll } : { add }
  return { plugin, add, addAll, publishes }
}

// Performance P1 (round 34): N sidebar rows were N palette publishes to add and N to remove.
describe('the palette bridge registers a batch as one change (performance P1)', () => {
  it('publishes 100 rows once and withdraws them once', () => {
    const fake = fakePlugin({ batched: true })
    // SAFETY: the bridge calls only `add` and `addAll`, which the fake provides.
    const dispose = PaletteBridge.addActionsTo(fake.plugin as PluginContext, actions(100))
    expect(fake.addAll).toHaveBeenCalledOnce()
    expect(fake.add).not.toHaveBeenCalled()
    expect(fake.publishes.count).toBe(1)
    dispose()
    expect(fake.publishes.count).toBe(2)
  })

  it("falls back to one add per row where the page's DSHX runtime has no addAll", () => {
    const fake = fakePlugin({ batched: false })
    // SAFETY: an older DSHX runtime's context, without `addAll`; the bridge checks for it.
    PaletteBridge.addActionsTo(fake.plugin as PluginContext, actions(3))
    expect(fake.add).toHaveBeenCalledTimes(3)
  })
})
