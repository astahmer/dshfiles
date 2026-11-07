// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubagentPreviewDock } from './subagent-preview-dock.js'
import type { SubagentPreviewBindings } from './subagent-live-preview.js'

afterEach(cleanup)

type Props = Parameters<typeof SubagentPreviewDock>[0]
const PARENT = 'session-parent'

const preview = (): SubagentPreviewBindings => ({
  // SAFETY: the preview only prints keys, so the identity translator covers every key it asks for.
  t: (key => key) as SubagentPreviewBindings['t'],
  retainChild: vi.fn(() => ({ ready: new Promise<never>(() => undefined), release: vi.fn() })),
  openChild: vi.fn(),
  openChildAside: vi.fn(),
  canOpenAside: () => false,
})

const dockProps = (input: { readonly running: readonly string[]; readonly bindings?: SubagentPreviewBindings }): Props => {
  const list = {
    byId: {},
    projectionsBySession: {
      [PARENT]: {
        values: {
          subagentCatalog: [
            { id: 'child-a', mode: 'one-shot', label: 'Review' },
            { id: 'child-b', mode: 'continuable', label: 'Refactor' },
            { id: 'child-c', mode: 'external', label: 'Remote' },
          ],
        },
      },
    },
  }
  const statuses = new Map(['child-a', 'child-b', 'child-c'].map(id => [id, { running: input.running.includes(id) }]))
  return {
    sessionId: PARENT,
    preview: input.bindings ?? preview(),
    // SAFETY: the dock reads only these fields of the session list.
    useSessions: selector => selector(list as never),
    // SAFETY: the dock reads only `running` of each status.
    useSessionStatus: selector => selector(statuses as never),
  }
}

const rows = () => document.querySelectorAll('[data-dshfiles-live-preview="agent"]')

describe('SubagentPreviewDock', () => {
  it('lists working children only, and clears as they go idle', () => {
    const { rerender } = render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-c'] })} />)
    expect([...rows()].map(row => row.getAttribute('aria-label'))).toEqual(['subagentPreviewKind: Review'])
    rerender(<SubagentPreviewDock {...dockProps({ running: [] })} />)
    expect(document.querySelector('[data-dshfiles-live-preview-dock]')).toBeNull()
  })

  it('holds a child open only while its row is expanded', () => {
    const bindings = preview()
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings })} />)
    expect(bindings.retainChild).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewToggle' }))
    expect(bindings.retainChild).toHaveBeenCalledOnce()
  })
})
