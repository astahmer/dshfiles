import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CredentialRecoveryAction, CredentialRecoveryTail } from './credential-recovery-message.js'

const NO_KEY =
  'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment.'

const render = (failure: { readonly code: string; readonly message: string }): string =>
  renderToStaticMarkup(<CredentialRecoveryAction {...failure} onOpenAccounts={() => undefined} actionLabel="Connect an account" />)

describe('the account action in the failure card', () => {
  it('leads a credential failure with one primary "Connect an account", even when core set no code', () => {
    const html = render({ code: '', message: NO_KEY })
    expect(html).toContain('Connect an account')
    expect(html).toContain('data-variant="default"')
  })

  it('offers nothing for an unrelated failure', () => {
    expect(render({ code: 'RATE_LIMIT', message: '429: {"message":"slow down"}' })).toBe('')
  })

  it('keeps the action under the turn where the Chat has no failure-card seat (the native Chat)', () => {
    // SAFETY: the tail reads only the turn's end event: its seq and its error reason.
    const turn = { end: { seq: 7, data: { reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'no key', status: 401 } } } } } as never
    const html = renderToStaticMarkup(<CredentialRecoveryTail turn={turn} onOpenAccounts={() => undefined} actionLabel="Connect an account" />)
    expect(html).toContain('Connect an account')
  })
})
