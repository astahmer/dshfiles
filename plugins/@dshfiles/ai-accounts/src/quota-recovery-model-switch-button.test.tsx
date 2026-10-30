import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuotaRecoveryModelSwitchButton } from './quota-recovery-model-switch-button.js'

describe('QuotaRecoveryModelSwitchButton', () => {
  it.each([false, true])('keeps the route toggle low-emphasis while expanded=%s', expanded => {
    const markup = renderToStaticMarkup(<QuotaRecoveryModelSwitchButton disabled={false} expanded={expanded} onClick={() => undefined} />)

    expect(markup).toContain('data-variant="ghost"')
    expect(markup).toContain(expanded ? 'Hide model options' : 'Resume with another model')
  })
})
