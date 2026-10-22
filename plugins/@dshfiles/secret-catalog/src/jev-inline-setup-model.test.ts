import { describe, expect, it } from 'vitest'
import { jevSetupView } from './jev-inline-setup-model.js'

describe('Jev inline setup view', () => {
  it('hides the prompt when Jev is disabled or the Host resolves the key', () => {
    expect(jevSetupView({ enabled: false, needsSetup: true, reference: '' })).toBe('hidden')
    expect(jevSetupView({ enabled: true, needsSetup: false, reference: 'secret:DSH_JEV_BACKLOG' })).toBe('hidden')
  })

  it('offers setup only when no secret reference is configured', () => {
    expect(jevSetupView({ enabled: true, needsSetup: true, reference: '' })).toBe('offer')
    expect(jevSetupView({ enabled: true, needsSetup: true, reference: '   ' })).toBe('offer')
  })

  it('shows a resolution warning instead of suggesting a duplicate when a reference is configured', () => {
    expect(jevSetupView({ enabled: true, needsSetup: true, reference: 'secret:DSH_JEV_BACKLOG' })).toBe('reference-unresolved')
  })
})
