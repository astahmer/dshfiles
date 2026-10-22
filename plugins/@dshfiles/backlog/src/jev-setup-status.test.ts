import { describe, expect, it } from 'vitest'
import { jevNeedsSecretSetup } from './jev-setup-status.js'

describe('Backlog Jev setup status', () => {
  it('does not resolve a key while Jev is disabled', async () => {
    let resolutions = 0
    const needsSetup = await jevNeedsSecretSetup({
      enabled: false,
      resolveKey: async () => {
        resolutions += 1
        return undefined
      },
    })

    expect(needsSetup).toBe(false)
    expect(resolutions).toBe(0)
  })

  it('returns status only when the Host resolves a synthetic key', async () => {
    const needsSetup = await jevNeedsSecretSetup({
      enabled: true,
      resolveKey: async () => 'synthetic-jev-key',
    })

    expect(needsSetup).toBe(false)
    expect(JSON.stringify({ needsSetup })).not.toContain('synthetic-jev-key')
  })

  it('suggests setup when the key is missing or its reference cannot resolve', async () => {
    await expect(jevNeedsSecretSetup({ enabled: true, resolveKey: async () => undefined })).resolves.toBe(true)
    await expect(
      jevNeedsSecretSetup({
        enabled: true,
        resolveKey: async () => {
          throw new Error('synthetic resolver failure')
        },
      }),
    ).resolves.toBe(true)
  })
})
