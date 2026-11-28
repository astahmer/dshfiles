import { describe, expect, it } from 'vitest'
import { CapabilitiesHub } from './hub-model.js'

// DESIGN.md › Language: no "Host" and no protocol acronyms on a user page.
describe('the hub in plain words', () => {
  it('says neither "Host" nor "OIDC"', () => {
    const copy = [...CapabilitiesHub.sections.flatMap(section => [section.summary, section.trustDetail, section.manager.label]), CapabilitiesHub.skillsSh.inAppSearchReason]
    expect(copy.filter(text => /\bHost\b|OIDC/u.test(text))).toEqual([])
  })

  it('names the Capabilities page as the rail does', () => {
    expect(CapabilitiesHub.sections.find(section => section.id === 'skills')?.manager.label).toBe('Capabilities')
  })
})
