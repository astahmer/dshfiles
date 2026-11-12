// @vitest-environment jsdom
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubagentPreviewDock } from './subagent-preview-dock.js'
import type { SubagentPreviewBindings } from './subagent-live-preview.js'

afterEach(cleanup)

type Props = Parameters<typeof SubagentPreviewDock>[0]
const PARENT = 'session-parent'
const STARTED_AT = 1_000

const preview = (overrides: Partial<SubagentPreviewBindings> = {}): SubagentPreviewBindings => ({
  // SAFETY: the preview only prints keys, so the identity translator covers every key it asks for.
  t: (key => key) as SubagentPreviewBindings['t'],
  retainChild: vi.fn(() => ({ ready: new Promise<never>(() => undefined), release: vi.fn() })),
  openChild: vi.fn(),
  openChildAside: vi.fn(),
  canOpenAside: () => false,
  ...overrides,
})

/** A child whose event window already reports one tool in flight. */
const childInTool = (input: { readonly cancel?: () => Promise<{ readonly ok: true }> } = {}) => {
  const entry = { type: 'event', event: { type: 'tool/call', data: { name: 'bash' }, seq: 2, time: 2 } }
  const eventSource = {
    getSnapshot: () => ({ entries: [entry], hasMore: false, revision: 0, change: { kind: 'replace', entries: [entry] } }),
    subscribe: () => () => undefined,
  }
  const cancel = input.cancel ?? vi.fn(async () => ({ ok: true as const }))
  const binding = { eventSource, session: { cancel } }
  // SAFETY: the dock reads only the event source and cancel of a retained child.
  const ready = Promise.resolve(binding as unknown as SessionBinding)
  return { cancel, retainChild: vi.fn(() => ({ ready, release: vi.fn() })) }
}

const sessionList = (input: { readonly childTiming: boolean }) => ({
  byId: input.childTiming
    ? {
        'child-a': {
          projectionValues: {
            subagentTiming: { settledMs: 0, active: { since: STARTED_AT, through: STARTED_AT + 1_000 } },
            threadSidebarModelRoute: 'openai/gpt-6.1-luna',
          },
        },
      }
    : {},
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
})

const dockProps = (input: {
  readonly running: readonly string[]
  readonly bindings?: SubagentPreviewBindings
  readonly runCards?: boolean
  readonly childTiming?: boolean
}): Props => {
  const statuses = new Map(['child-a', 'child-b', 'child-c'].map(id => [id, { running: input.running.includes(id) }]))
  return {
    sessionId: PARENT,
    preview: input.bindings ?? preview(),
    runCards: input.runCards ?? false,
    // SAFETY: the dock reads only these fields of the session list.
    useSessions: selector => selector(sessionList({ childTiming: input.childTiming ?? false }) as never),
    // SAFETY: the dock reads only `running` of each status.
    useSessionStatus: selector => selector(statuses as never),
  }
}

const rows = () => document.querySelectorAll('[data-dshfiles-live-preview="agent"]')
const cardOf = () => screen.getByRole('region', { name: /^Agent run: Review/ })
const fold = () => document.querySelector('[data-dshfiles-live-preview-fold="subagents"]')

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

  it('shows a single working child without a fold row', () => {
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'] })} />)
    expect(fold()).toBeNull()
    expect(rows()).toHaveLength(1)
  })

  it("folds two or more working children into one closed row and keeps the reader's choice as children come and go", () => {
    const count = (n: number): string => `${n} subagents`
    const { rerender } = render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b'] })} count={count} />)
    expect(fold()?.textContent).toBe('2 subagents subagentpreviewworking')
    expect(fold()?.getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '2 subagents subagentpreviewworking' }))
    expect(fold()?.getAttribute('aria-expanded')).toBe('true')
    expect(rows()).toHaveLength(2)
    rerender(<SubagentPreviewDock {...dockProps({ running: ['child-b'] })} count={count} />)
    expect(fold()).toBeNull()
    expect(rows()).toHaveLength(1)
    rerender(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b'] })} count={count} />)
    expect(fold()?.getAttribute('aria-expanded')).toBe('true')
    expect(rows()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '2 subagents subagentpreviewworking' }))
    expect(rows()).toHaveLength(0)
  })

  it('shows the compact run card for a working child whose turn, route and tool are known', async () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    expect((await screen.findByRole('region', { name: /^Agent run: Review/ })).textContent).toContain('subagentRunStepTool')
    expect(cardOf().textContent).toContain('openai/gpt-6.1-luna')
    expect(cardOf().textContent).toContain('subagentRunStep')
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  })

  it('stops the child through its interrupt after a confirmation', async () => {
    const child = childInTool()
    render(
      <SubagentPreviewDock
        {...dockProps({ running: ['child-a'], bindings: preview({ retainChild: child.retainChild }), runCards: true, childTiming: true })}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'subagentPreviewStop' }))
    expect(child.cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewConfirmStop' }))
    await Promise.resolve()
    expect(child.cancel).toHaveBeenCalledOnce()
  })

  it('keeps the confirmation cancellable without losing the card', async () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'subagentPreviewStop' }))
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewKeepWorking' }))
    expect(screen.getByRole('button', { name: 'subagentPreviewStop' })).not.toBeNull()
    expect(cardOf()).not.toBeNull()
  })

  it('opens the child thread from the card', async () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'subagentPreviewOpenThread' }))
    expect(bindings.openChild).toHaveBeenCalledWith('child-a')
  })

  it('expands the live progress without duplicating the card actions', async () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    await screen.findByRole('region', { name: /^Agent run:/ })
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewToggle' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'subagentPreviewToggle' }).getAttribute('aria-expanded')).toBe('true'))
    expect(screen.getAllByRole('button', { name: 'subagentPreviewStop' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'subagentPreviewOpenThread' })).toHaveLength(1)
  })

  it('keeps the one-line row until the open turn is known', async () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: false })} />)
    expect(screen.getByRole('button', { name: 'subagentPreviewToggle' })).not.toBeNull()
    expect(screen.queryByRole('region', { name: /^Agent run:/ })).toBeNull()
    expect(bindings.retainChild).toHaveBeenCalled()
  })

  it('never holds a child while the run card setting is off', () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: false, childTiming: true })} />)
    expect(bindings.retainChild).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /^Agent run:/ })).toBeNull()
  })
})
