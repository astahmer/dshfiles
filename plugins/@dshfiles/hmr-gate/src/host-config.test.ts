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
})
