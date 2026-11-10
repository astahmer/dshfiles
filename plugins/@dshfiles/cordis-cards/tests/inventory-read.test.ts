import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/native/index.ts'

// The card components are never rendered here; their primitives package imports CSS modules Node cannot load.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({}))

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
}

const fixture = (generation: { readonly generation: number } | undefined) => {
  const ctx = new Context()
  const inventory = vi.fn(async () => ({ ok: true as const, value: [] }))
  ctx.provide('locale', { register: () => () => {} })
  ctx.provide('slots', { inject: () => () => {} })
  ctx.provide('remote', { dynamicCordisRunner: { inventory }, $on: () => () => {} })
  ctx.provide('dynamicCordisRunner', { getSnapshot: () => [], subscribe: () => () => {}, reconcileApprovals: () => {} })
  ctx.provide('connection', { interactions: 'full', generation: { getSnapshot: () => generation } })
  apply(ctx)
  return { ctx, inventory }
}

describe('the Cordis inventory', () => {
  it('is read once at boot: the read waits for the first connected generation, a later one reads again', async () => {
    const { ctx, inventory } = fixture(undefined)
    await settle()
    expect(inventory).not.toHaveBeenCalled()

    ctx.emit('connection/reset')
    await settle()
    expect(inventory).toHaveBeenCalledTimes(1)

    ctx.emit('connection/reset')
    await settle()
    expect(inventory).toHaveBeenCalledTimes(2)
  })

  it('is read at setup when the page is already connected', async () => {
    const { inventory } = fixture({ generation: 1 })
    await settle()
    expect(inventory).toHaveBeenCalledTimes(1)
  })
})
