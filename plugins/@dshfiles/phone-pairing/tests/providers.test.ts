import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { resolveProvider as resolveProviderEffect, type Provider } from '../src/providers.ts'

const resolveProvider = (preferred?: Provider) => Effect.runPromise(resolveProviderEffect(preferred).pipe(Effect.provide(NodeServices.layer)))

describe('provider resolution', () => {
  it('prefers Tailscale, then the public tunnel, and honours an explicit choice', async () => {
    const auto = await resolveProvider()
    expect(['tailscale-serve', 'cloudflared', 'manual']).toContain(auto.provider)
    const explicit = await resolveProvider('manual')
    expect(explicit.provider).toBe('manual')
    expect(explicit.availability.map(option => option.provider)).toEqual(['tailscale-funnel', 'tailscale-serve', 'cloudflared', 'manual'])
  })

  it('reports an install command for a missing binary provider', async () => {
    const { availability } = await resolveProvider()
    for (const option of availability) {
      if (option.available) continue
      if (option.provider === 'manual') expect(option.install).toBeUndefined()
      else expect(option.install).toMatch(/brew install|nix profile install/)
    }
  })
})
