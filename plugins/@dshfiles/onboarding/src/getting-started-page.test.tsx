// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { GettingStartedPage } from './getting-started-page.js'
import { OnboardingOverview, type OverviewInput } from './overview-model.js'
import { PackPlan, type PluginEntryFact } from './pack-plan.js'
import type { RouteServices } from './routes.js'
import { ONBOARDING_DEFAULTS } from './settings.js'

afterEach(cleanup)

const facts = { account: { source: 'providers' as const, routes: 0 }, projects: [{ path: '/work/app', vcs: 'git' as const }], github: 'signed-out' as const }

const entries: readonly PluginEntryFact[] = [
  { entryId: 'include:dshfiles-backlog', plugin: 'backlog', moduleName: '@dshfiles/backlog', enabled: true, readOnlyReason: null },
  { entryId: 'include:dshfiles-goal-tool', plugin: 'goal-tool', moduleName: '@dshfiles/goal-tool', enabled: false, readOnlyReason: null },
]

/** The real overview and pack preview over the generated catalog, as the Host computes them. */
const loadOverview = vi.fn(async (request: OverviewInput) =>
  OnboardingOverview.overview({
    catalog: FEATURE_CATALOG,
    facts,
    states: PackPlan.statesOf(entries),
    request,
    curatedDefault: true,
    preview:
      request.preview === undefined
        ? null
        : PackPlan.preview({
            ...request.preview,
            entries,
            toolchain: { kind: 'manual', reason: 'Not linked from a checkout.' },
            profile: 'scratch',
            homeFromEnv: false,
            prerequisites: new Map(),
          }),
  }),
)

/** Each plugin's Host answer: the row switch waits for a restart, the installs come back as commands to run. */
const applyPack = vi.fn(async (input: { readonly pack: string; readonly action: 'enable' | 'disable'; readonly plugins: readonly string[] }) => {
  const overview = await loadOverview({ preview: { pack: input.pack, action: input.action } })
  if (overview.preview === null) throw new Error('no preview')
  const results = input.plugins.map(plugin =>
    plugin === 'goal-tool'
      ? { plugin, step: input.action, status: 'restart-required' as const, restartReason: 'no-hmr', detail: null }
      : { plugin, step: 'install' as const, status: 'manual' as const, restartReason: null, detail: 'Not linked from a checkout.' },
  )
  return { preview: overview.preview, results, summary: PackPlan.summarize({ preview: overview.preview, results }) }
})

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

const renderPage = (input: { readonly registered: readonly string[]; readonly packs?: boolean; readonly whatsNew?: boolean }) => {
  const services = routes(input.registered)
  const loadWhatsNew = vi.fn(async () => ({
    state: 'no-checkout' as const,
    reason: 'Not linked from a checkout.',
    commitsUrl: 'https://github.com/astahmer/dshfiles/commits/main',
  }))
  const loadSuggestions = vi.fn(async () => ({ state: 'ready' as const, days: 30, suggestions: [] }))
  const startWizard = vi.fn()
  const showWhere = vi.fn()
  const copy = vi.fn(async () => true)
  render(
    <PluginQueryProvider>
      <GettingStartedPage
        applyPack={applyPack}
        copy={copy}
        loadOverview={(request, _signal) => loadOverview(request)}
        loadSuggestions={loadSuggestions}
        loadWhatsNew={loadWhatsNew}
        routes={services}
        settings={{ ...ONBOARDING_DEFAULTS, packs: input.packs ?? true, whatsNew: input.whatsNew ?? true }}
        showWhere={showWhere}
        startWizard={startWizard}
      />
    </PluginQueryProvider>,
  )
  return { services, startWizard, showWhere, copy, loadWhatsNew, loadSuggestions }
}

describe('GettingStartedPage', () => {
  it('offers usage suggestions off by default, reads nothing, and opens the setting when asked', async () => {
    const page = renderPage({ registered: [] })
    const section = await screen.findByRole('region', { name: /^Suggestions/u })
    expect(section.getAttribute('data-suggestions')).toBe('off')
    fireEvent.click(within(section).getByRole('button', { name: 'Turn on in Settings' }))
    expect(page.services.opened).toEqual(['settings:{"setting":{"entryId":"dshfiles-onboarding","fieldPath":["suggestions"]}}'])
    expect(page.loadSuggestions).not.toHaveBeenCalled()
  })

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
    expect(within(packs).getByText('goal-tool · disabled')).toBeTruthy()
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
    expect(unregistered === null || unregistered === undefined ? [] : within(unregistered).queryAllByRole('button', { name: /^Open / })).toEqual([])

    fireEvent.click(within(backlogRow).getByRole('button', { name: /^Show me where: / }))
    expect(page.showWhere).toHaveBeenCalledWith(backlogRow.dataset.feature)

    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    expect(page.startWizard).toHaveBeenCalledOnce()
    expect((await screen.findByRole('region', { name: /What's new/u })).dataset.whatsNew).toBe('no-checkout')
  })

  it('searches every feature, narrows by destination and hides packs and What’s new when their settings are off', async () => {
    const page = renderPage({ registered: [], packs: false, whatsNew: false })
    await screen.findByRole('region', { name: /Setup checklist/u })
    expect(screen.queryByRole('region', { name: /Packs/u })).toBeNull()
    expect(screen.queryByRole('region', { name: /What's new/u })).toBeNull()
    expect(page.loadWhatsNew).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: 'onboarding checklist' } })
    await waitFor(() => expect(loadOverview).toHaveBeenLastCalledWith({ query: 'onboarding checklist' }))
    await screen.findByText('See what this setup can do and what it still needs on one page')
    fireEvent.click(await screen.findByRole('button', { name: /^Knowledge/u }))
    await waitFor(() => expect(loadOverview).toHaveBeenLastCalledWith({ query: 'onboarding checklist', destination: 'knowledge' }))
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: 'zzzz-no-such-feature' } })
    await screen.findByText('No feature matches every word.')
  }, 20_000)

  it('previews a pack change, and Cancel changes nothing', async () => {
    applyPack.mockClear()
    renderPage({ registered: [] })
    const planning = within(await screen.findByRole('region', { name: /Packs/u }))
      .getAllByRole('listitem')
      .find(item => item.dataset.pack === 'planning')
    if (planning === undefined) throw new Error('no planning pack')
    fireEvent.click(within(planning).getByRole('button', { name: 'Enable pack: Backlog & planning' }))
    const dialog = await screen.findByRole('dialog', { name: 'Enable Backlog & planning' })
    await within(dialog).findByRole('region', { name: 'Install by hand' })
    expect(within(dialog).getByRole('region', { name: 'Enable' }).textContent).toContain('goal-tool')
    expect(
      within(dialog).getByRole('button', {
        name: /Copy node tooling\/dshx\/packages\/dshx\/dist\/cli\/bin\.js add @dshfiles\/backlog-jira --profile scratch/u,
      }),
    ).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: 'Restart' }).textContent).toMatch(/Restart when idle/u)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(applyPack).not.toHaveBeenCalled()
  })

  it('says Up to date and offers no confirm when nothing would change', async () => {
    applyPack.mockClear()
    renderPage({ registered: [] })
    const observe = within(await screen.findByRole('region', { name: /Packs/u }))
      .getAllByRole('listitem')
      .find(item => item.dataset.pack === 'observe')
    if (observe === undefined) throw new Error('no observe pack')
    fireEvent.click(within(observe).getByRole('button', { name: 'Disable pack: Observe & perf' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disable Observe & perf' })
    await within(dialog).findByText(/^Up to date/u)
    expect(within(dialog).queryByRole('button', { name: 'Disable pack' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(applyPack).not.toHaveBeenCalled()
  })

  it('applies one plugin per Host call after confirm and reports a partial result as partial', async () => {
    applyPack.mockClear()
    renderPage({ registered: [] })
    const planning = within(await screen.findByRole('region', { name: /Packs/u }))
      .getAllByRole('listitem')
      .find(item => item.dataset.pack === 'planning')
    if (planning === undefined) throw new Error('no planning pack')
    fireEvent.click(within(planning).getByRole('button', { name: 'Enable pack: Backlog & planning' }))
    const dialog = await screen.findByRole('dialog', { name: 'Enable Backlog & planning' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Enable pack' }))
    const summary = await within(dialog).findByText('Partly done')
    expect(summary.closest('[data-summary]')?.getAttribute('data-summary')).toBe('partial')
    expect(applyPack.mock.calls.map(([call]) => call.plugins)).toEqual([['goal-tool'], ['backlog-jira'], ['backlog-notion'], ['schedule'], ['queue-reorder']])
    expect(within(dialog).getByText(/restart reason|no-hmr/u)).toBeTruthy()
  })
})
