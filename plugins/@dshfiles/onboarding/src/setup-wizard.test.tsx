// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { OnboardingOverview } from './overview-model.js'
import type { RouteServices } from './routes.js'
import { SetupWizard, STARTER_PROMPTS } from './setup-wizard.js'
import { WizardStore } from './wizard-store.js'

afterEach(() => {
  cleanup()
  WizardStore.finish('done')
  window.localStorage.clear()
})

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

/** The wizard as the client mounts it: the step lives in WizardStore, per browser, like the outcome. */
const Harness = (props: {
  readonly insertPrompt: (text: string) => void
  readonly phone: boolean
  readonly services: RouteServices
  readonly onFinish: () => void
  readonly onClose: () => void
}) => (
  <PluginQueryProvider>
    <SetupWizard
      insertPrompt={props.insertPrompt}
      loadOverview={loadOverview}
      onClose={props.onClose}
      onFinish={props.onFinish}
      onStepChange={WizardStore.setStep}
      open
      phone={props.phone}
      routes={props.services}
      step={WizardStore.useStep()}
    />
  </PluginQueryProvider>
)

const renderWizard = (insertPrompt: (text: string) => void, phone = false) => {
  const services = routes()
  const onFinish = vi.fn()
  const onClose = vi.fn()
  const view = render(<Harness insertPrompt={insertPrompt} onClose={onClose} onFinish={onFinish} phone={phone} services={services} />)
  return { services, onFinish, onClose, view }
}

describe('SetupWizard', () => {
  it('walks account, project and first task, inserts the prompt without sending, and keeps Don’t show again', async () => {
    const insertPrompt = vi.fn()
    const wizard = renderWizard(insertPrompt)
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Connect an AI account' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Open AI accounts' }))
    expect(wizard.services.opened).toEqual(['panel:ai-accounts'])

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('dialog', { name: 'Add a project' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Isolate new threads' }))
    expect(wizard.services.opened.at(-1)).toBe('settings:{"setting":{"entryId":"jj-integration","fieldPath":["isolateByDefault"]}}')
    fireEvent.click(screen.getByRole('button', { name: 'Add a project' }))
    expect(wizard.services.opened.at(-1)).toBe('settings:{"section":"dshfiles-workspace-folder-picker-projects"}')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('dialog', { name: 'Start a first task' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: STARTER_PROMPTS[1] }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert prompt' }))
    expect(insertPrompt).toHaveBeenCalledWith(STARTER_PROMPTS[1])
    expect(screen.getByRole('status').textContent).toBe('In the composer. Send it when ready.')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Add a project' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Don't show again" }))
    expect(wizard.onFinish).toHaveBeenCalledWith('skipped')
  })

  it('is a non-modal card: a setup link opens its page beside it, and the card comes back on the same step', async () => {
    const first = renderWizard(() => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const card = screen.getByRole('dialog', { name: 'Add a project' })
    expect(card.getAttribute('aria-modal')).toBe('false')
    expect(card.contains(document.activeElement)).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a project' }))
    expect(first.services.opened).toEqual(['settings:{"section":"dshfiles-workspace-folder-picker-projects"}'])
    expect(first.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add a project' })).toBeTruthy()

    first.view.unmount()
    renderWizard(() => undefined)
    expect(screen.getByText('Step 2 of 3')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Add a project' })).toBeTruthy()
  })

  it('puts the card away for now on Escape or the close button and keeps nothing', () => {
    const wizard = renderWizard(() => undefined)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'Escape' })
    expect(wizard.onClose).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(wizard.onClose).toHaveBeenCalledTimes(2)
    expect(wizard.onFinish).not.toHaveBeenCalled()
  })

  it('is a non-modal bottom sheet on a phone with the same steps and controls', () => {
    renderWizard(() => undefined, true)
    const sheet = screen.getByRole('dialog', { name: 'Connect an AI account' })
    expect(sheet.dataset.slot).toBe('sheet-content')
    expect(sheet.dataset.setupWizard).toBe('account')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(screen.getByRole('button', { name: "Don't show again" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
  })
})
