import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/native/index.ts'

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
}

const fixture = (generation: { readonly generation: number } | undefined) => {
  const ctx = new Context()
  const syncInspectManifest = vi.fn(async () => ({ ok: true as const, value: null }))
  ctx.provide('loader', {})
  ctx.provide('modules', {})
  ctx.provide('slots', { onEntryError: () => () => {} })
  ctx.provide('remote', { dynamicCordisRunner: { syncInspectManifest }, $on: () => () => {} })
  ctx.provide('connection', { interactions: 'full', generation: { getSnapshot: () => generation } })
  apply(ctx)
  return { ctx, syncInspectManifest }
}

describe('the Client inspect manifest', () => {
  it('is published once at boot: the first connected generation sends it, later ones send it again', async () => {
    const { ctx, syncInspectManifest } = fixture(undefined)
    await settle()
    expect(syncInspectManifest).not.toHaveBeenCalled()

    ctx.emit('connection/reset')
    await settle()
    expect(syncInspectManifest).toHaveBeenCalledTimes(1)

    ctx.emit('connection/reset')
    await settle()
    expect(syncInspectManifest).toHaveBeenCalledTimes(2)
  })

  it('is published at setup when the page is already connected', async () => {
    const { syncInspectManifest } = fixture({ generation: 1 })
    await settle()
    expect(syncInspectManifest).toHaveBeenCalledTimes(1)
  })
})
