// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { OPEN_SETTINGS_EVENT } from '@dshfiles/settings-shell/open-settings'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnAdmissionDock, waitingLine } from '../src/turn-admission-panel.tsx'

const snapshot = {
  policy: { maxRunningThreads: 3, countSubagents: false },
  running: 3,
  waiting: [{ sessionId: 'session-a', ahead: 2, since: 0 }],
}
const forceStart = vi.fn(async () => Promise.reject(new Error('The turn could not start.')))

vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => ({ snapshot: async () => snapshot, forceStart, configure: vi.fn() }),
}))

afterEach(cleanup)

describe('TurnAdmissionDock', () => {
  it('says the turn waits to start in plain words', () => {
    expect(waitingLine({ ahead: 2, running: 3, limit: 3 })).toBe('Waits to start · 2 ahead · 3 of 3 running')
  })

  it('turns a failed Start now into Try again with a way to Settings › General', async () => {
    render(
      <PluginQueryProvider>
        <TurnAdmissionDock sessionId="session-a" />
      </PluginQueryProvider>,
    )
    expect((await screen.findByRole('status')).textContent).toContain('Waits to start · 2 ahead · 3 of 3 running')
    expect(screen.queryByText(/free slot/u)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The turn could not start.')
    expect(alert.textContent).not.toMatch(/^Could not start\.$/u)
    const requests: unknown[] = []
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) requests.push(event.detail)
      event.preventDefault()
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, listener)
    fireEvent.click(screen.getByRole('button', { name: 'Settings › General' }))
    window.removeEventListener(OPEN_SETTINGS_EVENT, listener)
    expect(requests).toEqual([{ section: 'general', query: 'Running threads limit' }])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(forceStart).toHaveBeenCalledTimes(2))
  })
})
