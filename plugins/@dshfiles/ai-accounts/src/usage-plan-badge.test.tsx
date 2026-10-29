import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsagePlanBadge } from './usage-plan-badge.js'

describe('UsagePlanBadge', () => {
  it.each([null, '', '   ', '\n\t'])('omits an unknown or blank plan (%j)', plan => {
    expect(renderToStaticMarkup(<UsagePlanBadge plan={plan} />)).toBe('')
  })

  it.each(['plus', 'max', 'business', 'pro_200', 'Pro+', 'enterprise'])('preserves provider wording (%s)', plan => {
    const markup = renderToStaticMarkup(<UsagePlanBadge plan={` ${plan} `} />)
    expect(markup).toContain(`aria-label="Subscription plan: ${plan}"`)
    expect(markup).not.toContain('title=')
    expect(markup).toContain(`>${plan}</span>`)
  })

  it('bounds long plan text while keeping its full accessible name', () => {
    const plan = 'Enterprise'.repeat(6)
    const markup = renderToStaticMarkup(<UsagePlanBadge plan={plan} />)
    expect(markup).toContain('dshx:max-w-[30%]')
    expect(markup).toContain('dshx:shrink')
    expect(markup).toContain('dshx:truncate')
    expect(markup).toContain(`aria-label="Subscription plan: ${plan}"`)
  })

  it('renders provider text as escaped text, not markup', () => {
    const markup = renderToStaticMarkup(<UsagePlanBadge plan={'<script>alert("plan")</script>'} />)
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;')
  })
})
