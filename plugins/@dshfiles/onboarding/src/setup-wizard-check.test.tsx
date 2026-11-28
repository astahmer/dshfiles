// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Overview } from './overview-model.js'
import type { RouteServices } from './routes.js'
import { SetupWizard } from './setup-wizard.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const routes: RouteServices = {
  hasPanel: () => true,
  openPanel: () => true,
  hasCommand: () => false,
  runCommand: () => false,
  hasSettings: () => true,
  openSettings: () => true,
}

const renderWizard = (loadOverview: () => Promise<Overview>) =>
  render(
    <PluginQueryProvider>
      <SetupWizard insertPrompt={() => undefined} loadOverview={loadOverview} onClose={() => undefined} onFinish={() => undefined} onStepChange={() => undefined} open phone={false} routes={routes} step="account" />
    </PluginQueryProvider>,
  )

describe('the setup check that does not answer', () => {
  it('stops saying Checking… after 5 s and offers Retry', async () => {
    vi.useFakeTimers()
    const loadOverview = vi.fn(() => new Promise<Overview>(() => undefined))
    renderWizard(loadOverview)
    expect(screen.getByText('Checking…')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100)
    })
    expect(screen.queryByText('Checking…')).toBeNull()
    expect(screen.getByText('Could not check your accounts.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(loadOverview).toHaveBeenCalledTimes(2)
  })

  it('never shows a step with an empty body when its check failed', async () => {
    renderWizard(() => Promise.reject(new Error('HTTP 500')))
    expect(await screen.findByText('Could not check your accounts.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
