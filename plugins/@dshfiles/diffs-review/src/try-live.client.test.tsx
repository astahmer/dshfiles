// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TryLive } from './try-live.js'

vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => ({
    landImpact: async () => ({
      applies: true,
      reason: null,
      checkout: { workspace: 'default' },
      plan: { changedFiles: 2, restartNeeded: true, restartReasons: ['host code'], installs: [], plugins: [{ name: 'chat', client: true, host: true }] },
    }),
  }),
}))

afterEach(cleanup)

describe('TryLive', () => {
  it('points to Restart DSH on the rail, not the status strip', async () => {
    render(
      <PluginQueryProvider>
        <TryLive bookmark="main" cwd="/work/thread" />
      </PluginQueryProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try this change live' }))
    const hint = await screen.findByTestId('try-live-restart-hint')
    expect(hint.textContent).toContain('Restart DSH (bottom of the rail)')
    expect(hint.textContent).not.toContain('status strip')
    expect((await screen.findByTestId('try-live-restart')).textContent).toContain('Needs a restart')
  })
})
