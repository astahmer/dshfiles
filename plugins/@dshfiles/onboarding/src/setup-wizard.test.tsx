// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { OnboardingOverview } from './overview-model.js'
import type { RouteServices } from './routes.js'
import { SetupWizard, STARTER_PROMPTS } from './setup-wizard.js'

afterEach(cleanup)

const loadOverview = async () =>
  OnboardingOverview.overview({
    catalog: FEATURE_CATALOG,
    facts: { account: { source: 'providers', routes: 0 }, projects: [], github: 'off' },
    states: null,
    request: {},
    curatedDefault: true,
    preview: null,
  })

const routes = (): RouteServices & { readonly opened: string[] } => {
  const opened: string[] = []
  return {
    opened,
    hasPanel: () => true,
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

const renderWizard = (insertPrompt: (text: string) => boolean) => {
  const services = routes()
  const onFinish = vi.fn()
  render(
    <PluginQueryProvider>
      <SetupWizard insertPrompt={insertPrompt} loadOverview={loadOverview} onFinish={onFinish} open routes={services} />
    </PluginQueryProvider>,
  )
  return { services, onFinish }
}

describe('SetupWizard', () => {
  it('walks account, project and first task, inserts the prompt without sending, and reports skip', async () => {
    const insertPrompt = vi.fn(() => true)
    const wizard = renderWizard(insertPrompt)
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Connect an AI account' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Open AI accounts' }))
    expect(wizard.services.opened).toEqual(['panel:ai-accounts'])

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('region', { name: 'Add a project' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Isolate new threads' }))
    expect(wizard.services.opened.at(-1)).toBe('settings:{"setting":{"entryId":"jj-integration","fieldPath":["isolateByDefault"]}}')
    fireEvent.click(screen.getByRole('button', { name: 'Add a project' }))
    expect(wizard.services.opened.at(-1)).toBe('settings:{"section":"dshfiles-workspace-folder-picker-projects"}')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('region', { name: 'Start a first task' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: STARTER_PROMPTS[1] }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert prompt' }))
    expect(insertPrompt).toHaveBeenCalledWith(STARTER_PROMPTS[1])
    expect(screen.getByRole('status').textContent).toBe('In the composer. Send it when ready.')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('region', { name: 'Add a project' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(wizard.onFinish).toHaveBeenCalledWith('skipped')
  })

  it('finishes with done and says when no composer could take the prompt', () => {
    const wizard = renderWizard(() => false)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert prompt' }))
    expect(screen.getByRole('status').textContent).toBe('No composer is open. Open a thread, then insert again.')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(wizard.onFinish).toHaveBeenCalledWith('done')
  })

  it('stays out of the way: no modal dialog, and Escape skips it', () => {
    const wizard = renderWizard(() => true)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'Escape' })
    expect(wizard.onFinish).toHaveBeenCalledWith('skipped')
  })
})
