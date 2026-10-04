import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { accountRuntime, activateAccountRuntime } from './account-runtime.js'

describe('account runtime ownership', () => {
  it('shares state with child contexts and disposes only its own host', async () => {
    const first = new Context()
    const second = new Context()
    const firstFiber = await first.plugin(ctx => {
      activateAccountRuntime(ctx)
    })
    const secondFiber = await second.plugin(ctx => {
      activateAccountRuntime(ctx)
    })
    try {
      expect(accountRuntime(first)).toBeDefined()
      expect(accountRuntime(first.extend())).toBe(accountRuntime(first))
      expect(accountRuntime(first)).not.toBe(accountRuntime(second))
      await firstFiber.dispose()
      expect(accountRuntime(first)).toBeUndefined()
      expect(accountRuntime(second)).toBeDefined()
    } finally {
      await firstFiber.dispose()
      await secondFiber.dispose()
    }
    expect(accountRuntime(second)).toBeUndefined()
  })
})
