import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RECOVERY_POLICY } from './failure-policy.js'
import { FailureHandlingDisclosure, failureHandlingSummary } from './failure-handling-disclosure.js'

describe('failure handling in Settings', () => {
  it('reads default until a failure option differs from what ships', () => {
    expect(failureHandlingSummary({ policy: DEFAULT_RECOVERY_POLICY, stalledStreamFallback: false })).toBe('default')
    expect(failureHandlingSummary({ policy: DEFAULT_RECOVERY_POLICY, stalledStreamFallback: true })).toBe('customised')
    expect(
      failureHandlingSummary({
        policy: { ...DEFAULT_RECOVERY_POLICY, rateLimit: { ...DEFAULT_RECOVERY_POLICY.rateLimit, failover: false } },
        stalledStreamFallback: false,
      }),
    ).toBe('customised')
  })
  it('shows one row and an Edit verb instead of the matrix of controls', () => {
    const markup = renderToStaticMarkup(
      <FailureHandlingDisclosure summary="default">
        <label>Retry the same account</label>
      </FailureHandlingDisclosure>,
    )
    expect(markup).toContain('Failure handling: default')
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="Edit failure handling"/u)
    expect(markup).not.toContain('Retry the same account')
  })
  it('is what the Settings section renders its failure options through', () => {
    expect(readFileSync(new URL('settings-section.tsx', import.meta.url), 'utf8')).toContain('<FailureHandlingDisclosure')
  })
  it('can start open, for a deep link to one of its options', () => {
    const markup = renderToStaticMarkup(
      <FailureHandlingDisclosure defaultOpen summary="customised">
        <label>Retry the same account</label>
      </FailureHandlingDisclosure>,
    )
    expect(markup).toContain('Failure handling: customised')
    expect(markup).toContain('Retry the same account')
  })
})
