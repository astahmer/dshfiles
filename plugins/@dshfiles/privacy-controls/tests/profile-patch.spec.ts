import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'
import { readManagedOverrides, withFeatureStates, type FeatureUpdate } from '../src/profile-patch.js'

const userPatch = `# User-owned profile settings.
- id: unrelated-row
  config:
    keep: true
`

const updates: readonly FeatureUpdate[] = [
  { feature: 'answer-feedback-ui', enabled: true },
  { feature: 'session-feedback-capture', enabled: false },
]

describe('privacy controls profile patch', () => {
  it('appends only marked row-state overrides and preserves unrelated YAML', () => {
    const next = withFeatureStates(userPatch, updates)
    const document = parseDocument(next)
    expect(document.errors).toHaveLength(0)
    expect(next.startsWith(userPatch)).toBe(true)
    expect(readManagedOverrides(next)).toEqual(
      new Map([
        ['answer-feedback-ui:message-feedback', false],
        ['answer-feedback-ui:ui-message-feedback', false],
        ['session-feedback-capture:command-feedback', true],
      ]),
    )
  })

  it('replaces only its own feature blocks and is stable on a repeated write', () => {
    const next = withFeatureStates(userPatch, updates)
    const changed = withFeatureStates(next, [{ feature: 'answer-feedback-ui', enabled: false }])
    expect(changed).toContain('# dshfiles-privacy-controls:v1 session-feedback-capture\n- id: command-feedback\n  disabled: true')
    expect(readManagedOverrides(changed).get('answer-feedback-ui:message-feedback')).toBe(true)
    expect(readManagedOverrides(changed).get('answer-feedback-ui:ui-message-feedback')).toBe(true)
    expect(withFeatureStates(changed, [{ feature: 'answer-feedback-ui', enabled: false }])).toBe(changed)
  })

  it('supports CRLF profile files without changing their line-ending style', () => {
    const crlfPatch = userPatch.replaceAll('\n', '\r\n')
    const next = withFeatureStates(crlfPatch, [{ feature: 'otel-session-upload', enabled: true }])
    expect(next).toContain('\r\n# dshfiles-privacy-controls:v1 otel-session-upload\r\n- id: session-telemetry-otel\r\n  disabled: false\r\n')
    expect(next.replaceAll('\r\n', '')).not.toContain('\n')
  })

  it('refuses non-list and malformed managed content instead of risking the profile patch', () => {
    expect(() => withFeatureStates('root:\n  - id: row\n', updates)).toThrow(/plain top-level YAML list/)
    expect(() => readManagedOverrides('# dshfiles-privacy-controls:v1 answer-feedback-ui\n- id: message-feedback\n  disabled: maybe\n')).toThrow(
      /unsupported shape/,
    )
  })
})
