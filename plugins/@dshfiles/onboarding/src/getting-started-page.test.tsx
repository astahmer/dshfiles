// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { GettingStartedPage } from './getting-started-page.js'
import { OnboardingOverview, type OverviewInput } from './overview-model.js'
import type { RouteServices } from './routes.js'
import { ONBOARDING_DEFAULTS } from './settings.js'

afterEach(cleanup)

const facts = { providers: 0, projects: [{ path: '/work/app', vcs: 'git' as const }], github: 'signed-out' as const }

/** The real overview over the generated catalog, as the Host computes it. */
const loadOverview = vi.fn(async (request: OverviewInput) =>
  OnboardingOverview.overview({ catalog: FEATURE_CATALOG, facts, states: new Map([['backlog', 'enabled' as const]]), request, curatedDefault: true }),
)

const routes = (registered: readonly string[]): RouteServices & { readonly opened: string[] } => {
  const opened: string[] = []
  return {
    opened,
    hasPanel: panelId => registered.includes(panelId),
    openPanel: panelId => {
      opened.push(`panel:${panelId}`)
      return true
    },
    hasCommand: () => false,
    runCommand: () => false,
    hasSettings: () => true,
    openSettings: request => {
      opened.push(`settings:${JSON.stringify(request)}`)
      return true
    },
  }
}

const renderPage = (input: { readonly registered: readonly string[]; readonly packs?: boolean }) => {
  const services = routes(input.registered)
  const startWizard = vi.fn()
  const copy = vi.fn(async () => true)
  render(
    <PluginQueryProvider>
      <GettingStartedPage
        copy={copy}
        loadOverview={(request, _signal) => loadOverview(request)}
        routes={services}
        settings={{ ...ONBOARDING_DEFAULTS, packs: input.packs ?? true }}
        startWizard={startWizard}
      />
    </PluginQueryProvider>,
  )
  return { services, startWizard, copy }
}

describe('GettingStartedPage', () => {
  it('shows the checklist, packs and features, and opens only registered routes', async () => {
    const page = renderPage({ registered: ['ai-accounts', 'dshfiles-backlog-panel'] })
    const checklist = await screen.findByRole('region', { name: /Setup checklist/u })
    expect(within(checklist).getByText('2 of 4')).toBeTruthy()
    fireEvent.click(within(checklist).getByRole('button', { name: 'Open AI accounts' }))
    expect(page.services.opened).toEqual(['panel:ai-accounts'])
    fireEvent.click(within(checklist).getByRole('button', { name: 'Copy gh auth login' }))
    expect(page.copy).toHaveBeenCalledWith('gh auth login')

    const packs = screen.getByRole('region', { name: /Packs/u })
    expect(within(packs).getByText('backlog · enabled')).toBeTruthy()
    expect(within(packs).getByText('backlog-jira · not installed')).toBeTruthy()
    fireEvent.click(within(packs).getByRole('button', { name: 'Isolate each new thread in its own workspace' }))
    expect(page.services.opened.at(-1)).toBe('settings:{"setting":{"entryId":"jj-integration","fieldPath":["isolateByDefault"]}}')

    const features = screen.getByRole('list', { name: 'Features' })
    const openButtons = within(features).getAllByRole('button', { name: /^Open / })
    expect(openButtons.length).toBeGreaterThan(0)
    const backlogRow = within(features).getAllByText('backlog')[0]?.closest('li')
    if (backlogRow === null || backlogRow === undefined) throw new Error('no backlog row')
    fireEvent.click(within(backlogRow).getByRole('button', { name: /^Open / }))
    expect(page.services.opened.at(-1)).toBe('panel:dshfiles-backlog-panel')
    const unregistered = within(features).getAllByText('traces')[0]?.closest('li')
    expect(unregistered === null || unregistered === undefined ? [] : within(unregistered).queryAllByRole('button')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    expect(page.startWizard).toHaveBeenCalledOnce()
  })

  it('searches every feature, narrows by destination and hides packs when the setting is off', async () => {
    renderPage({ registered: [], packs: false })
    await screen.findByRole('region', { name: /Setup checklist/u })
    expect(screen.queryByRole('region', { name: /Packs/u })).toBeNull()
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: 'onboarding checklist' } })
    await waitFor(() => expect(loadOverview).toHaveBeenLastCalledWith({ query: 'onboarding checklist' }))
    await screen.findByText('See what this setup can do and what it still needs on one page')
    fireEvent.click(await screen.findByRole('button', { name: /^Knowledge/u }))
    await waitFor(() => expect(loadOverview).toHaveBeenLastCalledWith({ query: 'onboarding checklist', destination: 'knowledge' }))
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: 'zzzz-no-such-feature' } })
    await screen.findByText('No feature matches every word.')
  }, 20_000)
})
