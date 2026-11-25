// @vitest-environment jsdom

import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationDialog } from './automation-dialog.js'
import { AutomationFormModel } from './automation-form.js'

const api = vi.hoisted(() => ({
  list: vi.fn(async (): Promise<{ readonly automations: readonly unknown[] }> => ({ automations: [] })),
  runs: vi.fn(async (): Promise<{ readonly runs: readonly unknown[] }> => ({ runs: [] })),
}))
vi.mock('@dshfiles/dshx/client', () => ({ useApi: () => api }))
// The kit's copy hook reads the Host clipboard helper; its bundle pulls icon packages a test has no use for.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: async () => true }))

const { AutomationsPanel } = await import('./automations-panel.js')

afterEach(cleanup)

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const renderPanel = () =>
  render(
    <PluginQueryProvider>
      <AutomationsPanel openThread={() => undefined} projects={() => []} threads={() => []} />
    </PluginQueryProvider>,
  )

describe('the Automations page', () => {
  it('is a kit Page whose description names Schedules for a prompt in an existing thread', async () => {
    renderPanel()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Automations' })
    expect(heading.closest('[data-slot="page-header"]')).not.toBeNull()
    expect(heading.closest('[data-slot="page"]')).not.toBeNull()
    expect(screen.getByText(/^Start a new thread on a schedule or from a webhook\. For a prompt in an existing thread, use/u)).toBeTruthy()
  })

  it('shows no Recent runs section while there is no automation', async () => {
    renderPanel()
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    await screen.findByText(/No automations yet/u)
    expect(screen.queryByRole('region', { name: 'Recent runs' })).toBeNull()
    expect(screen.queryByText(/Use Run now/u)).toBeNull()
  })
})

describe('the automation dialog fields', () => {
  const open = (triggerKind: 'schedule' | 'webhook') =>
    render(
      <AutomationDialog
        open
        editing={false}
        initial={{ ...AutomationFormModel.empty({ projectId: 'p', timeZone: 'Europe/Paris' }), triggerKind }}
        projects={[{ projectId: 'p', title: 'sample', path: '/tmp/sample' }]}
        threads={[]}
        pending={false}
        error={null}
        onOpenChange={() => undefined}
        onSubmit={() => undefined}
      />,
    )

  it('picks the time and the time zone instead of typing formats', async () => {
    open('schedule')
    await screen.findByRole('dialog', { name: 'New automation' })
    const time = screen.getByLabelText('Time')
    expect(time.getAttribute('type')).toBe('time')
    expect(screen.getByRole('combobox', { name: 'Time zone' }).textContent).toContain('Europe/Paris')
    expect(document.body.textContent).not.toMatch(/HH:mm|IANA|\{\{body/u)
  })

  it('keeps the webhook template syntax with the webhook trigger', async () => {
    open('webhook')
    await screen.findByRole('dialog', { name: 'New automation' })
    expect(document.body.textContent).toContain('{{body.path.to.field}}')
  })
})
