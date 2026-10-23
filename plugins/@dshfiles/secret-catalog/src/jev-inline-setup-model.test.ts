import { describe, expect, it } from 'vitest'
import { jevSetupView } from './jev-inline-setup-model.js'

describe('Jev inline setup view', () => {
  it('hides everything while Jev is disabled, and the offer when the environment supplies a key', () => {
    expect(jevSetupView({ enabled: false, needsSetup: true, reference: 'secret:DSH_JEV_BACKLOG' })).toBe('hidden')
    expect(jevSetupView({ enabled: true, needsSetup: false, reference: '' })).toBe('hidden')
  })

  it('offers setup only when no secret reference is configured', () => {
    expect(jevSetupView({ enabled: true, needsSetup: true, reference: '' })).toBe('offer')
    expect(jevSetupView({ enabled: true, needsSetup: true, reference: '   ' })).toBe('offer')
  })

  it('hands a configured reference to the repair card instead of suggesting a duplicate', () => {
    expect(jevSetupView({ enabled: true, needsSetup: true, reference: 'secret:DSH_JEV_BACKLOG' })).toBe('repair')
    expect(jevSetupView({ enabled: true, needsSetup: false, reference: 'secret:DSH_JEV_BACKLOG' })).toBe('repair')
  })
})
