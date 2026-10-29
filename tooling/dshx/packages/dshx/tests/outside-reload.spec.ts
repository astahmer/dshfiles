import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { runOutsideReload, scheduleOutsideReload } from '../src/host/index.js'

/** The slice of DSH's HMR service the helper reads: the store that marks a running reload. */
const reloadingContext = () => {
  const executing = new AsyncLocalStorage<boolean>()
  const ctx = new Context()
  ctx.provide('hmr', { executing })
  return { ctx, executing }
}

describe('runOutsideReload', () => {
  it('runs a callback armed inside a reload transaction with the reload mark cleared', async () => {
    const { ctx, executing } = reloadingContext()
    const seen = await executing.run(
      true,
      () =>
        new Promise<{ readonly inherited: boolean | undefined; readonly outside: boolean | undefined }>(resolve => {
          setTimeout(() => {
            const inherited = executing.getStore()
            runOutsideReload(ctx, () => resolve({ inherited, outside: executing.getStore() }))
          }, 0)
        }),
    )
    expect(seen).toEqual({ inherited: true, outside: undefined })
  })

  it('runs the callback unchanged on a Host without the HMR service', () => {
    expect(runOutsideReload(new Context(), () => 'ran')).toBe('ran')
  })

  it('schedules a timer whose callback runs outside the transaction it was armed in, and cancels it', async () => {
    const { ctx, executing } = reloadingContext()
    const outside = await executing.run(
      true,
      () => new Promise<boolean | undefined>(resolve => scheduleOutsideReload(ctx, () => resolve(executing.getStore()), 0)),
    )
    expect(outside).toBeUndefined()

    let fired = false
    const cancel = executing.run(true, () => scheduleOutsideReload(ctx, () => (fired = true), 0))
    cancel()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(fired).toBe(false)
  })
})
