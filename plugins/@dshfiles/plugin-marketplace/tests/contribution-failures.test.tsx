// @vitest-environment jsdom

import type { ContributionFailure } from '@dshfiles/dshx/client'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContributionFailuresModel } from '../src/contribution-failures.js'
import { en, type MarketplaceLocaleKey } from '../src/locales.js'

const failures = vi.hoisted((): { current: readonly ContributionFailure[] } => ({ current: [] }))

vi.mock('@dshfiles/dshx/client', async original => ({
  ...(await original<typeof import('@dshfiles/dshx/client')>()),
  useContributionFailures: () => failures.current,
}))

const t = (key: MarketplaceLocaleKey, params: Record<string, string | number> = {}): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), en[key])

const bundle = (name: string) => ({ kind: 'bundle' as const, pkg: { name } })

afterEach(() => {
  cleanup()
  failures.current = []
})

describe('contribution failures on the Plugins page', () => {
  it('tags and lists only the failures of the page subject', () => {
    failures.current = [
      { owner: '@acme/plugin', kind: 'component', id: 'panel:acme', message: 'render broke', at: 0 },
      { owner: '@other/plugin', kind: 'registry', id: 'dshx.command', message: 'not mine', at: 0 },
    ]
    const Badge = ContributionFailuresModel.createBadge(t)
    const Section = ContributionFailuresModel.createSection(t)
    render(
      <>
        <Badge subject={bundle('@acme/plugin')} />
        <Section subject={bundle('@acme/plugin')} />
      </>,
    )
    expect(screen.getByRole('status').textContent).toBe('1 failed')
    expect(screen.getByRole('region', { name: 'Failed contributions' }).textContent).toContain('component panel:acme')
    expect(screen.queryByText('not mine')).toBeNull()
  })

  it('renders nothing for a plugin without failures or an official item', () => {
    failures.current = [{ owner: '@acme/plugin', kind: 'setup', id: 'setup', message: 'boom', at: 0 }]
    const Badge = ContributionFailuresModel.createBadge(t)
    const { container } = render(
      <>
        <Badge subject={bundle('@quiet/plugin')} />
        <Badge subject={{ kind: 'item', id: 'official' }} />
      </>,
    )
    expect(container.innerHTML).toBe('')
  })
})
