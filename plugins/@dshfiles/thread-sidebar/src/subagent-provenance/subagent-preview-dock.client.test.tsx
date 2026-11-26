// @vitest-environment jsdom
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubagentPreviewDock } from './subagent-preview-dock.js'
import type { SubagentPreviewBindings } from './subagent-live-preview.js'
import { threadSidebarDictionaries } from '../locales.js'

afterEach(cleanup)

type Props = Parameters<typeof SubagentPreviewDock>[0]
const PARENT = 'session-parent'
const STARTED_AT = 1_000
const CHILDREN = ['child-a', 'child-b', 'child-c', 'child-d', 'child-e'] as const

const preview = (overrides: Partial<SubagentPreviewBindings> = {}): SubagentPreviewBindings => ({
  // SAFETY: the preview only prints keys, so the identity translator covers every key it asks for.
  t: (key => key) as SubagentPreviewBindings['t'],
  retainChild: vi.fn(() => ({ ready: new Promise<never>(() => undefined), release: vi.fn() })),
  openChild: vi.fn(),
  openChildAside: vi.fn(),
  canOpenAside: () => false,
  ...overrides,
})

/** A child whose event window reports one tool in flight, or none (between tools) when `tool` is null. */
const childFeed = (tool: string | null, cancel: () => Promise<{ readonly ok: true }>) => {
  const entries = tool === null ? [] : [{ type: 'event', event: { type: 'tool/call', data: { name: tool }, seq: 2, time: 2 } }]
  const eventSource = {
    getSnapshot: () => ({ entries, hasMore: false, revision: 0, change: { kind: 'replace', entries } }),
    subscribe: () => () => undefined,
  }
  // SAFETY: the dock reads only the event source and cancel of a retained child.
  return Promise.resolve({ eventSource, session: { cancel } } as unknown as SessionBinding)
}

/** Children held through one binding; each child's tool comes from `tools` (default: a command). */
const childInTool = (input: { readonly cancel?: () => Promise<{ readonly ok: true }>; readonly tool?: string; readonly tools?: Record<string, string | null> } = {}) => {
  const cancel = input.cancel ?? vi.fn(async () => ({ ok: true as const }))
  const retainChild = vi.fn((childId: string) => {
    const tool = input.tools?.[childId] === undefined ? (input.tool ?? 'bash') : (input.tools[childId] ?? null)
    return { ready: childFeed(tool, cancel), release: vi.fn() }
  })
  return { cancel, retainChild }
}

const sessionList = (input: { readonly childTiming: boolean }) => ({
  byId: input.childTiming
    ? Object.fromEntries(
        ['child-a', 'child-b'].map(id => [
          id,
          {
            projectionValues: {
              subagentTiming: { settledMs: 0, active: { since: STARTED_AT, through: STARTED_AT + 1_000 } },
              threadSidebarModelRoute: 'openai/gpt-6.1-luna',
            },
          },
        ]),
      )
    : {},
  projectionsBySession: {
    [PARENT]: {
      values: {
        subagentCatalog: [
          { id: 'child-a', mode: 'one-shot', label: 'Review' },
          { id: 'child-b', mode: 'continuable', label: 'Refactor' },
          { id: 'child-c', mode: 'external', label: 'Remote' },
          { id: 'child-d', mode: 'one-shot', label: 'Lint' },
          { id: 'child-e', mode: 'one-shot', label: 'Docs' },
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
  const statuses = new Map(CHILDREN.map(id => [id, { running: input.running.includes(id) }]))
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
const dockRows = () => [...document.querySelectorAll<HTMLElement>('[data-subagent-dock-row]')]
const rowOf = (label: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[aria-label="subagentPreviewKind: ${label}"]`)
  if (row === null) throw new Error(`no dock row for ${label}`)
  return row
}
const fold = () => document.querySelector<HTMLElement>('[data-dshfiles-live-preview-fold="subagents"]')
const openFold = (): void => {
  const button = fold()
  if (button === null) throw new Error('no fold row')
  fireEvent.click(button)
}

describe('SubagentPreviewDock', () => {
  it('lists working children only, and clears as they go idle', () => {
    const { rerender } = render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-c'] })} />)
    expect([...rows()].map(row => row.getAttribute('aria-label'))).toEqual(['subagentPreviewKind: Review'])
    rerender(<SubagentPreviewDock {...dockProps({ running: [] })} />)
    expect(document.querySelector('[data-dshfiles-live-preview-dock]')).toBeNull()
  })

  it('holds a child open only while its row is expanded when the step setting is off', () => {
    const bindings = preview()
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings })} />)
    expect(bindings.retainChild).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewToggle' }))
    expect(bindings.retainChild).toHaveBeenCalledOnce()
  })

  it('draws a child in a tool and a child between tools as the same compact row, never a card', async () => {
    // One child was a 133 px card while its sibling between tools was a 34 px row, and each flipped between the two.
    const bindings = preview({ retainChild: childInTool({ tools: { 'child-a': 'bash', 'child-b': null } }).retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b'], bindings, runCards: true, childTiming: true })} />)
    await waitFor(() => expect(rowOf('Review').querySelector('[data-subagent-run-step]')?.textContent).toBe('Running a command'))
    expect(fold()).toBeNull()
    expect(dockRows()).toHaveLength(2)
    expect(document.querySelector('[data-subagent-run-card]')).toBeNull()
    for (const label of ['Review', 'Refactor']) {
      const row = rowOf(label)
      expect(row.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('working')
      expect(row.querySelectorAll('[data-live-elapsed]')).toHaveLength(1)
      expect(row.querySelector('[data-subagent-dock-row]')?.className).toContain('dshx:h-8')
      expect(row.querySelectorAll('button')).toHaveLength(2)
    }
    expect(rowOf('Refactor').querySelector('[data-subagent-run-step]')).toBeNull()
  })

  it('ends in a fixed action column, so every row\'s tabular elapsed time ends on one edge (council round 18 B1.2)', async () => {
    // "Open thread" is narrower than a job row's "Open in Processes": with content-sized actions the clocks sat ~24px apart.
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b'], bindings, runCards: true, childTiming: true })} />)
    for (const label of ['Review', 'Refactor']) {
      const row = rowOf(label)
      const action = row.querySelector<HTMLElement>('[data-live-work-action]')
      expect(action?.textContent).toBe('subagentPreviewOpenThread')
      // The job row's "Open in Processes ↗" renders 132px at 1440px: the column is 8.5rem, 136px (measured, round 18).
      expect(action?.className).toContain('dshx:min-w-34')
      expect(action?.className).toContain('dshx:justify-end')
      // A narrow pane shows the action as its arrow alone: the column gives way to a 44px target.
      expect(action?.className).toContain('dshx:@max-pane-narrow:min-w-11')
      expect(action?.classList.contains('dshx:shrink')).toBe(false)
      expect(row.querySelector('[data-live-elapsed]')?.className).toContain('dshx:tabular-nums')
    }
  })

  it('shows the open arrow alone at rest and its words on row hover or focus, keeping the name (council round 22, item 13)', () => {
    // Six "Open thread ↗" in one column read as a wall of the same words.
    const bindings = preview()
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b'], bindings })} />)
    const row = rowOf('Review')
    expect(row.className).toContain('dshx:group/dock-row')
    const action = row.querySelector<HTMLElement>('[data-live-work-action]')
    const words = action?.querySelector<HTMLElement>('span')
    expect(words?.textContent).toBe('subagentPreviewOpenThread')
    const classes = words?.className.split(/\s+/u) ?? []
    expect(classes).toContain('dshx:sr-only')
    expect(classes).toContain('dshx:@pane-narrow:group-hover/dock-row:not-sr-only')
    expect(classes).toContain('dshx:@pane-narrow:group-has-[:focus-visible]/dock-row:not-sr-only')
    // The arrow stays; the accessible name is the words, at rest too.
    expect(action?.querySelector('svg')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'subagentPreviewOpenThread' })).toHaveLength(2)
  })

  it('says the step in words, never the tool identifier, and names the model on the row itself (council round 17 B1.1)', async () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    await waitFor(() => expect(document.querySelector('[data-subagent-run-step]')?.textContent).toBe('Running a command'))
    const row = rowOf('Review')
    expect(row.textContent).not.toMatch(/\bbash\b/u)
    // Collapsed: the kit's mark and the model's name, in the row's model column.
    const model = row.querySelector('[data-subagent-dock-row] [data-slot="route-model"]')
    expect(model?.textContent).toBe('gpt-6.1-luna')
    expect(model?.querySelector('[data-model-mark="openai"]')).not.toBeNull()
    const order = [...(row.querySelector('[data-subagent-dock-row] [data-subagent-dock-meta]')?.children ?? [])].map(
      child => (child.hasAttribute('data-subagent-run-step') ? 'step' : child.getAttribute('data-slot')) ?? child.tagName,
    )
    // Council round 22, item 10: the model is a column after the name and its step, before the clock.
    expect(order.indexOf('route-model')).toBeGreaterThan(order.indexOf('step'))
    // The model's name, never the route id with its provider ("openai/gpt-6.1-luna"), and not a second time when open.
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewToggle' }))
    expect(row.querySelectorAll('[data-slot="route-model"]')).toHaveLength(1)
    expect(row.textContent).not.toContain('openai/')
  })

  it('splits a row into two lines on a narrow pane, so the task name keeps the full width (council round 22, item 1)', async () => {
    // Phone rows read "Check cr…" beside "deepseek-v4-flash 49s": the name, model and clock shared one 366px line.
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    await waitFor(() => expect(document.querySelector('[data-subagent-run-step]')).not.toBeNull())
    const row = rowOf('Review')
    const line = row.querySelector<HTMLElement>('[data-subagent-dock-row]')
    const toggle = line?.querySelector<HTMLElement>('button')
    // Line 1: ring and the title over the whole width; line 2 at the title's x: mark, model, · elapsed.
    expect(toggle?.className).toContain('dshx:@max-pane-narrow:grid')
    expect(toggle?.className).toContain('dshx:@max-pane-narrow:grid-cols-[auto_minmax(0,1fr)]')
    expect(toggle?.querySelector('svg[aria-hidden]')?.getAttribute('class')).toContain('dshx:@max-pane-narrow:hidden')
    const meta = toggle?.querySelector<HTMLElement>('[data-subagent-dock-meta]')
    expect(meta?.className).toContain('dshx:contents')
    expect(meta?.className).toContain('dshx:@max-pane-narrow:col-start-2')
    expect(meta?.className).toContain('dshx:@max-pane-narrow:flex')
    expect(meta?.querySelector('[data-slot="route-model"]')).not.toBeNull()
    expect(meta?.querySelector('[data-live-elapsed]')?.className).toContain('dshx:tabular-nums')
    expect(meta?.querySelector('[data-subagent-dock-separator]')?.textContent).toBe('·')
    // The title stays outside the meta line, so it spans line 1.
    expect(meta?.contains(toggle?.querySelector('[data-subagent-dock-title]') ?? null)).toBe(false)
    // Two lines stay a whole touch row: at least 44pt.
    expect(line?.className).toContain('dshx:@max-pane-narrow:min-h-[54px]')
    expect(line?.querySelector('[data-live-work-action]')?.className).toContain('dshx:@max-pane-narrow:self-stretch')
  })

  it('starts every model name on one x on a wide pane: a fixed column before a fixed clock seat (council round 22, item 10)', async () => {
    // The model followed each title, so "gpt-6-luna" and "deepseek-v4-flash" started wherever the title ended.
    const bindings = preview({ retainChild: childInTool({ tools: { 'child-a': 'bash', 'child-b': null } }).retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b'], bindings, runCards: true, childTiming: true })} />)
    await waitFor(() => expect(rowOf('Review').querySelector('[data-subagent-run-step]')).not.toBeNull())
    for (const label of ['Review', 'Refactor']) {
      const meta = rowOf(label).querySelector<HTMLElement>('[data-subagent-dock-meta]')
      const model = meta?.querySelector<HTMLElement>('[data-slot="route-model"]')
      // A fixed-width column that keeps the empty mark seat for a model without a family; a narrow pane lets it go.
      expect(model?.className).toContain('dshx:w-36')
      expect(model?.className).toContain('dshx:shrink-0')
      expect(model?.className).toContain('dshx:@max-pane-narrow:w-auto')
      // A fixed clock seat after it: "49s" and "1m 02s" no longer move the column.
      const clock = meta?.querySelector<HTMLElement>('[data-live-elapsed]')
      expect(clock?.className).toContain('dshx:min-w-12')
      expect(clock?.className).toContain('dshx:text-right')
      // The column follows the step, so a row in a tool and a row between tools put the model on the same x.
      const kids = [...(meta?.children ?? [])]
      const at = (match: (child: Element) => boolean): number => kids.findIndex(match)
      expect(at(child => child.getAttribute('data-slot') === 'route-model')).toBeGreaterThan(at(child => child.hasAttribute('data-subagent-run-step')))
    }
  })

  it('keeps the clock seat before the open turn is known, so the model column holds its x', () => {
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], runCards: true, childTiming: false })} />)
    expect(document.querySelector('[data-live-elapsed]')).toBeNull()
    expect(document.querySelector('[data-subagent-dock-clock-seat]')?.className).toContain('dshx:min-w-12')
  })

  it('names the model with the step setting off, and none when the route is unknown', () => {
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-d'], childTiming: true })} />)
    expect(rowOf('Review').querySelector('[data-slot="route-model"]')?.textContent).toBe('gpt-6.1-luna')
    expect(rowOf('Lint').querySelector('[data-slot="route-model"]')).toBeNull()
  })

  it('says a child held by a question waits for an answer, with the Needs-you glyph', async () => {
    const bindings = preview({ retainChild: childInTool({ tool: 'ask_parent_question' }).retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    await waitFor(() => expect(document.querySelector('[data-subagent-run-step]')?.textContent).toBe('subagentRunWaiting'))
    const row = rowOf('Review')
    expect(row.textContent).not.toContain('ask_parent_question')
    expect(row.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('needs-you')
    expect(row.hasAttribute('data-waiting')).toBe(true)
  })

  it('stops the child from the expanded row after a confirmation, and the confirmation can be cancelled', async () => {
    const child = childInTool()
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings: preview({ retainChild: child.retainChild }), runCards: true, childTiming: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewToggle' }))
    fireEvent.click(await screen.findByRole('button', { name: 'subagentPreviewStop' }))
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewKeepWorking' }))
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewStop' }))
    expect(child.cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewConfirmStop' }))
    await waitFor(() => expect(child.cancel).toHaveBeenCalledOnce())
  })

  it('opens the child thread from the row, and the expanded detail does not repeat it', async () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewToggle' }))
    await screen.findByRole('button', { name: 'subagentPreviewStop' })
    expect(screen.getAllByRole('button', { name: 'subagentPreviewOpenThread' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'subagentPreviewStop' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewOpenThread' }))
    expect(bindings.openChild).toHaveBeenCalledWith('child-a')
  })

  it('shows no clock until the open turn is known', () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: true, childTiming: false })} />)
    expect(dockRows()).toHaveLength(1)
    expect(document.querySelector('[data-live-elapsed]')).toBeNull()
  })

  it('never holds a child and shows no step or clock while the step-and-clock setting is off', () => {
    const bindings = preview({ retainChild: childInTool().retainChild })
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a'], bindings, runCards: false, childTiming: true })} />)
    expect(bindings.retainChild).not.toHaveBeenCalled()
    expect(dockRows()).toHaveLength(1)
    expect(document.querySelector('[data-subagent-run-step]')).toBeNull()
    expect(document.querySelector('[data-live-elapsed]')).toBeNull()
  })

  it('says the fold in one phrase of its own table, so Chinese has no English word in it', () => {
    // It joined core's translated count to the English "working": "Sous-agents 2 working".
    const zh = threadSidebarDictionaries.zh.subagentsWorking_other
    const foldLabel = (count: number): string => zh.replace('{count}', String(count))
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b', 'child-d', 'child-e'] })} foldLabel={foldLabel} />)
    expect(fold()?.textContent).toBe('4 个子智能体工作中')
    expect(fold()?.textContent).not.toMatch(/[A-Za-z]/u)
  })

  it('keeps every row whole and scrolls the dock instead, under its sticky fold row (round 21 D2)', () => {
    // Six working children on a phone squeezed each 44px row into a 31px section (the default flex-shrink in the
    // max-h-72 column), so the dock never scrolled and every row was clipped.
    render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b', 'child-d', 'child-e'] })} foldLabel={count => `${count} subagents`} />)
    openFold()
    const dock = document.querySelector<HTMLElement>('[data-dshfiles-live-preview-dock="subagents"]')
    expect(dock?.className).toContain('dshx:max-h-72')
    expect(dock?.className).toContain('dshx:overflow-y-auto')
    expect(fold()?.className).toContain('dshx:sticky')
    expect(rows()).toHaveLength(4)
    for (const row of rows()) expect(row.classList.contains('dshx:shrink-0')).toBe(true)
  })

  it("shows up to three rows, folds four or more into one closed row, and keeps the reader's choice", () => {
    const count = (n: number): string => `${n} subagents`
    const { rerender } = render(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b', 'child-d'] })} foldLabel={count} />)
    expect(fold()).toBeNull()
    expect(rows()).toHaveLength(3)
    rerender(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b', 'child-d', 'child-e'] })} foldLabel={count} />)
    expect(fold()?.getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)
    openFold()
    expect(rows()).toHaveLength(4)
    rerender(<SubagentPreviewDock {...dockProps({ running: ['child-b'] })} foldLabel={count} />)
    expect(fold()).toBeNull()
    expect(rows()).toHaveLength(1)
    rerender(<SubagentPreviewDock {...dockProps({ running: ['child-a', 'child-b', 'child-d', 'child-e'] })} foldLabel={count} />)
    expect(fold()?.getAttribute('aria-expanded')).toBe('true')
    expect(rows()).toHaveLength(4)
  })
})
