import { describe, expect, it } from 'vitest'
import host from './host.js'

describe('hmr-gate Loader row config', () => {
  it('activates a row without config (host reload off) and accepts hostReload: true', async () => {
    const config = host.Config
    if (config === undefined) throw new Error('hmr-gate declares a Loader Config')
    expect(await config['~standard'].validate(undefined)).toEqual({ value: {} })
    expect(await config['~standard'].validate({ hostReload: true })).toEqual({ value: { hostReload: true } })
    expect(await config['~standard'].validate({ hostReload: 'yes' })).toHaveProperty('issues')
  })

  it('accepts each applyUpdates policy and refuses another value', async () => {
    const config = host.Config
    if (config === undefined) throw new Error('hmr-gate declares a Loader Config')
    for (const applyUpdates of ['auto', 'immediately', 'when-hidden-or-idle'] as const) {
      expect(await config['~standard'].validate({ applyUpdates })).toEqual({ value: { applyUpdates } })
    }
    expect(await config['~standard'].validate({ applyUpdates: 'later' })).toHaveProperty('issues')
  })
})
