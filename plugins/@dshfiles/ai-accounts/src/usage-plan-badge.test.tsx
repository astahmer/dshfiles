import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsagePlanBadge } from './usage-plan-badge.js'

describe('UsagePlanBadge', () => {
  it.each([null, '', '   ', '\n\t'])('omits an unknown or blank plan (%j)', plan => {
    expect(renderToStaticMarkup(<UsagePlanBadge plan={plan} />)).toBe('')
  })

  it.each([
    ['plus', 'Plus'],
    ['business', 'Business'],
    ['pro_200', 'Pro 200'],
    ['individual-pro', 'Individual Pro'],
  ])('writes a provider plan id as a plain name (%s)', (plan, name) => {
    const markup = renderToStaticMarkup(<UsagePlanBadge plan={` ${plan} `} />)
    expect(markup).toContain(`aria-label="Subscription plan: ${name}"`)
    expect(markup).not.toContain('title=')
    expect(markup).toContain(`>${name}</span>`)
  })

  it.each(['Pro+', 'Enterprise', 'ChatGPT Team'])('keeps a name the provider already wrote for people (%s)', plan => {
    expect(renderToStaticMarkup(<UsagePlanBadge plan={plan} />)).toContain(`>${plan.replace('+', '+')}</span>`)
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
