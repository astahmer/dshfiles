// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { SubagentPreviewBindings } from './subagent-live-preview.js'
import { SubagentProvenanceToolRow } from './subagent-tool-row.js'

/** The Host's failed-turn record the row reads (round 21 D4); a test fills it per case. */
const failedTurns = vi.hoisted(() => new Map<string, { readonly sessionId: string; readonly failedAt: number; readonly reason: 'error' | 'max-tokens' }>())
vi.mock('./subagent-failed-turns.js', () => ({ useSubagentFailedTurns: () => failedTurns }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  DisclosureRow: ({
    icon,
    title,
    collapsedContent,
    headerAccessory,
    open,
    children,
    rowClassName,
    titleClassName,
  }: {
    icon: ReactNode
    title: string
    collapsedContent?: ReactNode
    headerAccessory?: ReactNode
    open: boolean
    children?: ReactNode
    rowClassName?: string
    titleClassName?: string
  }) => (
    <div>
      {/* The native row's shape: the leading box, then the text area whose content box holds the title first. */}
      <div data-disclosure-row="" className={rowClassName}>
        <span data-testid="leading">{icon}</span>
        <span>
          <span>
            <span data-testid="row-title" className={titleClassName}>
              {title}
            </span>
          </span>
        </span>
      </div>
      {headerAccessory === undefined ? null : <div data-testid="header-accessory">{headerAccessory}</div>}
      {collapsedContent === undefined ? null : <div data-testid="collapsed-content">{collapsedContent}</div>}
      {open ? <div data-testid="expanded-content">{children}</div> : null}
    </div>
  ),
  IconAgentPresetOutlineRegular: () => null,
  IconInspectOutlineRegular: () => null,
}))

type Props = Parameters<typeof SubagentProvenanceToolRow>[0]

const unused = (): never => {
  throw new Error('Unused in the tool row fixture')
}

const translate: Props['t'] = key => {
  if (key === 'tool.title.subagent') return 'Create subagent'
  if (key === 'row.inspect') return 'Inspect'
  return key
}

const previewBindings = (overrides: Partial<SubagentPreviewBindings> = {}): SubagentPreviewBindings => ({
  // SAFETY: the preview only prints keys, so the identity translator covers every key it asks for.
  t: (key => key) as SubagentPreviewBindings['t'],
  retainChild: vi.fn(() => ({ ready: new Promise<never>(() => undefined), release: vi.fn() })),
  openChild: vi.fn(),
  openChildAside: vi.fn(),
  canOpenAside: () => true,
  ...overrides,
})

const props = ({
  provider,
  model,
  prompt = 'Review this change',
  description,
  expanded = false,
}: {
  provider: string
  model: string
  prompt?: string
  description?: string
  expanded?: boolean
}): Props => ({
  phase: 'start',
  // SAFETY: fixture id only needs SessionId's brand; no Host validates it.
  sessionId: 'session-1' as SessionId,
  block: {
    phase: 'start',
    callId: 'call-1',
    name: 'subagent',
    turn: 1,
    step: 1,
    time: 1,
    subCalls: [],
    argsRaw: JSON.stringify({ prompt, provider, model, description }),
    args: PartialArguments.fromText(JSON.stringify({ prompt, provider, model, description })),
  },
  callId: 'call-1',
  toolName: 'subagent',
  cwd: '/workspace',
  home: '/home/test',
  openFile: unused,
  loadImage: unused,
  useDisclosure: () => ({ expanded, setExpanded: unused, toggle: unused }),
  useAccess: unused,
  useRemoteAccess: unused,
  useSessionAccess: unused,
  useWorkspaceAccess: unused,
  useWorkspaces: unused,
  usePanelInfo: unused,
  useResource: unused,
  // SAFETY: the row reads only `byId` of the session list.
  useSessions: selector => selector({ byId: {}, projectionsBySession: {} } as never),
  // SAFETY: an empty status map holds nothing to misread.
  useSessionStatus: selector => selector(new Map<string, never>() as never),
  useSessionRetainInfo: unused,
  useContextMenu: unused,
  useChat: unused,
  useConversation: unused,
  useInput: unused,
  inputActions: {
    captureInsertion: unused,
    insertText: unused,
    insertQuote: unused,
    setDraft: unused,
    persistDraft: unused,
    addAttachments: unused,
    removeAttachment: unused,
    pruneAttachments: unused,
    submit: unused,
  },
  useSession: unused,
  useProjection: unused,
  t: translate,
  preview: previewBindings(),
})

const CHILD = 'child-session'

/** A settled delegation: its result only names the child. */
const settled = (input: {
  readonly expanded?: boolean
  readonly running?: boolean
  readonly lastTurnCompleted?: boolean
  readonly preview?: SubagentPreviewBindings
  readonly isError?: boolean
  /** The result text; core names the child by its handle (`started subagent agent-1`). */
  readonly resultText?: string
  readonly settledMs?: number
  /** Browser clock of the child's open turn's start (`subagentTiming.active.since`). */
  readonly since?: number
}): Props => {
  const base = props({ provider: 'openai', model: 'gpt-6.1-luna', expanded: input.expanded ?? false })
  if (base.phase !== 'start') throw new Error('fixture starts from the start phase')
  // SAFETY: the row reads only these fields of a settled block.
  const block = {
    call: base.block,
    content: [{ type: 'text', text: input.isError === true ? 'no route' : (input.resultText ?? `started subagent ${CHILD}`) }],
    isError: input.isError === true,
  } as unknown as Extract<Props, { phase: 'result' }>['block']
  const statuses = new Map([[CHILD, { running: input.running === true }]])
  const list = {
    byId: {
      [CHILD]: {
        projectionValues: {
          subagentTiming: {
            lastTurnCompleted: input.lastTurnCompleted,
            settledMs: input.settledMs,
            active: input.since === undefined ? undefined : { since: input.since },
          },
        },
      },
    },
    projectionsBySession: {
      'session-1': { values: { subagentCatalog: [{ id: CHILD, name: 'agent-1', mode: 'continuable', label: 'Long child', createdAt: 1 }] } },
    },
  }
  // SAFETY: `base` is the start-phase fixture; this swaps it to the result phase with the block built above.
  return {
    ...base,
    phase: 'result',
    block,
    // SAFETY: the row reads only `running` of each status.
    useSessionStatus: selector => selector(statuses as never),
    // SAFETY: the row reads only `projectionValues` of a listed session.
    useSessions: selector => selector(list as never),
    preview: input.preview ?? previewBindings(),
  } as Props
}

const previewRoot = () => document.querySelector('[data-dshfiles-live-preview="agent"]')
/** The outcome at the row's end, after the model. */
const ending = () => screen.queryByTestId('header-accessory')?.querySelector('[data-subagent-ending]')?.textContent
const leadingStatus = () => screen.getByTestId('leading').querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')

afterEach(() => {
  cleanup()
  failedTurns.clear()
})

describe('SubagentProvenanceToolRow', () => {
  it('names the row by the task the parent gave, with no generated handle and no route', () => {
    // It read "Create subagent · Fern Puffin · Optimize traces plugin · openai/gpt-6.1-luna".
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', description: '  Optimize traces plugin ' })} />)
    expect(screen.getByText('subagentPreviewKind · Optimize traces plugin')).not.toBeNull()
  })

  it('shows the model it runs on after the description: the kit mark and the name, never the provider (council round 17 B1.1)', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', description: 'Optimize traces plugin' })} />)
    const model = screen.getByTestId('header-accessory').querySelector('[data-slot="route-model"]')
    expect(model?.textContent).toBe('gpt-6.1-luna')
    expect(model?.getAttribute('data-model-family')).toBe('openai')
    expect(model?.querySelector('[data-model-mark="openai"]')).not.toBeNull()
    // The title stays the task; the model is beside it, outside the running shimmer.
    expect(screen.getByText('subagentPreviewKind · Optimize traces plugin')).not.toBeNull()
  })

  it('draws no empty mark seat inline for a model with no known family (council round 22, item 8)', () => {
    // The seat lines names up only where they stack in a column (the list's line 2); inline it left a 16 px gap.
    render(<SubagentProvenanceToolRow {...props({ provider: 'dshx_fake_commandcode', model: 'step-5-preview', description: 'Review currency conversion' })} />)
    const model = screen.getByTestId('header-accessory').querySelector('[data-slot="route-model"]')
    expect(model?.textContent).toBe('step-5-preview')
    expect(model?.querySelector('[data-model-mark]')).toBeNull()
  })

  it('keeps an unknown model\'s empty mark seat in a run\'s shared column, so its name starts on the names\' x (council round 24, item 1)', () => {
    // "step-5-preview" started in the mark column of the eight-call group, 22 px left of every other name.
    const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'row-title' ? (this.textContent ?? '').length * 10 : 0
    })
    const seats: HTMLElement[] = []
    try {
      for (const [description, model] of [
        ['Audit', 'gpt-6.1-luna'],
        ['Review currency conversion', 'step-5-preview'],
        ['Check discount', 'gemini-3.8-flash'],
      ] as const) {
        const seat = document.createElement('div')
        seat.setAttribute('data-chat-flow-key', `seat-${String(seats.length)}`)
        seat.setAttribute('data-run-fold-member', 'member')
        seat.setAttribute('data-run-fold-run', 'run-seat')
        seat.setAttribute('data-run-fold-size', '3')
        document.body.append(seat)
        seats.push(seat)
        render(<SubagentProvenanceToolRow {...props({ provider: 'dshx_fake_commandcode', model, description })} />, { container: seat })
      }
      const unknown = seats[1]?.querySelector('[data-slot="route-model"]')
      expect(unknown?.textContent).toBe('step-5-preview')
      expect(unknown?.firstElementChild?.getAttribute('data-model-mark')).toBe('none')
      expect(unknown?.firstElementChild?.className).toContain('dshx:size-4')
    } finally {
      cleanup()
      for (const seat of seats) seat.remove()
      width.mockRestore()
    }
  })

  it('prefers the route the child really runs on over the one its call asked for', () => {
    const base = settled({ running: true })
    const list = {
      byId: { [CHILD]: { projectionValues: { threadSidebarModelRoute: 'anthropic/claude-opus-5-5', subagentTiming: {} } } },
      projectionsBySession: { 'session-1': { values: { subagentCatalog: [{ id: CHILD, name: 'agent-1', mode: 'continuable', label: 'Long child', createdAt: 1 }] } } },
    }
    // SAFETY: the row reads only `projectionValues` of a listed session and the parent's catalog.
    render(<SubagentProvenanceToolRow {...base} useSessions={selector => selector(list as never)} />)
    const model = screen.getByTestId('header-accessory').querySelector('[data-slot="route-model"]')
    expect(model?.textContent).toBe('claude-opus-5-5')
    expect(model?.getAttribute('data-model-family')).toBe('claude')
  })

  it('drops the "Subagent ·" prefix inside a run fold, whose summary names the kind (council round 22, item 9)', async () => {
    const seat = document.createElement('div')
    seat.setAttribute('data-chat-flow-key', 'row-1')
    document.body.append(seat)
    try {
      render(<SubagentProvenanceToolRow {...settled({ running: true })} />, { container: seat })
      expect(screen.getByText('subagentPreviewKind · Long child')).not.toBeNull()
      expect(document.querySelector('[data-dshfiles-subagent-row]')).not.toBeNull()
      act(() => seat.setAttribute('data-run-fold-member', 'member'))
      await waitFor(() => expect(screen.getByText('Long child')).not.toBeNull())
      act(() => seat.removeAttribute('data-run-fold-member'))
      await waitFor(() => expect(screen.getByText('subagentPreviewKind · Long child')).not.toBeNull())
    } finally {
      seat.remove()
    }
  })

  it('lines the titles of a run of three or more rows up in one column, capped at 320 px (council round 23, item 1)', () => {
    // jsdom lays nothing out: a title is 10 px per character.
    const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'row-title' ? (this.textContent ?? '').length * 10 : 0
    })
    const seats: HTMLElement[] = []
    const seatOf = (runKey: string, size: number): HTMLElement => {
      const seat = document.createElement('div')
      seat.setAttribute('data-chat-flow-key', `row-${String(seats.length)}`)
      seat.setAttribute('data-run-fold-member', 'member')
      seat.setAttribute('data-run-fold-run', runKey)
      seat.setAttribute('data-run-fold-size', String(size))
      document.body.append(seat)
      seats.push(seat)
      return seat
    }
    const row = (description: string, seat: HTMLElement) =>
      render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', description })} />, { container: seat })
    const columnOf = (seat: HTMLElement) => seat.querySelector<HTMLElement>('[data-dshfiles-subagent-row]')?.style.getPropertyValue('--dshfiles-subagent-title-column')
    try {
      const run = [seatOf('run-1', 3), seatOf('run-1', 3), seatOf('run-1', 3)]
      row('Audit', run[0]!)
      row('Check credit note rounding', run[1]!)
      row('Review currency', run[2]!)
      // The widest title (26 characters) sets the column for every row, so each model starts on one x.
      for (const seat of run) expect(columnOf(seat)).toBe('260px')
      expect(run[0]!.querySelector('[data-disclosure-row]')?.className).toContain('--dshfiles-subagent-title-column')
      // A longer title truncates in the 320 px cap instead of pushing every model right.
      const long = seatOf('run-1', 4)
      act(() => {
        row('Diff the ledger export against the monthly totals', long)
      })
      for (const seat of [...run, long]) expect(columnOf(seat)).toBe('320px')
      expect(long.querySelector('[data-testid="row-title"]')?.className).toContain('dshx:truncate')
      // A run of two keeps each row's own width.
      const pair = [seatOf('run-2', 2), seatOf('run-2', 2)]
      row('Audit', pair[0]!)
      row('Check credit note rounding', pair[1]!)
      for (const seat of pair) expect(columnOf(seat)).toBe('')
    } finally {
      cleanup()
      for (const seat of seats) seat.remove()
      width.mockRestore()
    }
  })

  it('rounds a fractional title width up, so the widest title is never cut by a fraction of a pixel', () => {
    // In the scratch: "Diff the ledger export against totals" laid out 210.375 px wide, scrollWidth said 210, and the
    // 210 px column ended it "against tota…".
    const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'row-title' ? Math.floor((this.textContent ?? '').length * 10.125) : 0
    })
    const rect = function (this: Range) {
      const length = this.startContainer.textContent?.length ?? 0
      // SAFETY: the column reads only `width`; jsdom has no DOMRect constructor to build one.
      return { width: length * 10.125, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: rect })
    const seats: HTMLElement[] = []
    try {
      for (const description of ['Audit', 'Diff the ledger export', 'Review currency']) {
        const seat = document.createElement('div')
        seat.setAttribute('data-chat-flow-key', `fraction-${String(seats.length)}`)
        seat.setAttribute('data-run-fold-member', 'member')
        seat.setAttribute('data-run-fold-run', 'run-fraction')
        seat.setAttribute('data-run-fold-size', '3')
        document.body.append(seat)
        seats.push(seat)
        render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', description })} />, { container: seat })
      }
      // 22 characters at 10.125 px: 222.75 px of text, so a 223 px column; the rounded scrollWidth said 222.
      for (const seat of seats) {
        expect(seat.querySelector<HTMLElement>('[data-dshfiles-subagent-row]')?.style.getPropertyValue('--dshfiles-subagent-title-column')).toBe('223px')
      }
    } finally {
      cleanup()
      for (const seat of seats) seat.remove()
      Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
      width.mockRestore()
    }
  })

  it('measures the titles again once web fonts load, so the widest title is never cut by a column set before them', () => {
    // The widest title was measured in the fallback font; truncated in the column, its box never resized as it widened.
    let scale = 10
    const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'row-title' ? (this.textContent ?? '').length * scale : 0
    })
    const fonts = Object.assign(new EventTarget(), { ready: new Promise<never>(() => undefined) })
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    const seats: HTMLElement[] = []
    try {
      for (const description of ['Audit', 'Diff the ledger export', 'Review currency']) {
        const seat = document.createElement('div')
        seat.setAttribute('data-chat-flow-key', `font-${String(seats.length)}`)
        seat.setAttribute('data-run-fold-member', 'member')
        seat.setAttribute('data-run-fold-run', 'run-fonts')
        seat.setAttribute('data-run-fold-size', '3')
        document.body.append(seat)
        seats.push(seat)
        render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', description })} />, { container: seat })
      }
      const columnOf = (seat: HTMLElement) => seat.querySelector<HTMLElement>('[data-dshfiles-subagent-row]')?.style.getPropertyValue('--dshfiles-subagent-title-column')
      expect(columnOf(seats[0]!)).toBe('220px')
      scale = 12
      act(() => {
        fonts.dispatchEvent(new Event('loadingdone'))
      })
      for (const seat of seats) expect(columnOf(seat)).toBe('264px')
    } finally {
      cleanup()
      for (const seat of seats) seat.remove()
      Reflect.deleteProperty(document, 'fonts')
      width.mockRestore()
    }
  })

  it('keeps the prefix in a run fold when the call names no task, so the row never reads empty', () => {
    const seat = document.createElement('div')
    seat.setAttribute('data-chat-flow-key', 'row-1')
    seat.setAttribute('data-run-fold-member', 'absorbed')
    document.body.append(seat)
    try {
      render(<SubagentProvenanceToolRow {...settled({ isError: true })} />, { container: seat })
      expect(screen.getByText('subagentPreviewKind')).not.toBeNull()
    } finally {
      seat.remove()
    }
  })

  it('falls back to the catalog label when the call gave no description', () => {
    render(<SubagentProvenanceToolRow {...settled({ running: true })} />)
    expect(screen.getByText('subagentPreviewKind · Long child')).not.toBeNull()
  })

  it('keeps the full prompt out of the collapsed preview', () => {
    const prompt = 'Review this change, inspect every related test, and report any regressions.'
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', prompt })} />)
    expect(screen.queryByTestId('collapsed-content')).toBeNull()
    expect(screen.queryByText(prompt)).toBeNull()
  })

  it('shows the full prompt when the row is expanded', () => {
    const prompt = 'Review this change, inspect every related test, and report any regressions.'
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', prompt, expanded: true })} />)
    expect(screen.getByTestId('expanded-content').textContent).toContain(prompt)
  })

  it('omits email-like route values from the visible tool card', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'alex@example.com', model: 'gpt-6.1-luna' })} />)
    expect(screen.getByText('subagentPreviewKind')).not.toBeNull()
    expect(screen.queryByText(/alex@example\.com/)).toBeNull()
    // An unsafe route names no model: no mark, no guess.
    expect(document.querySelector('[data-slot="route-model"]')).toBeNull()
  })

  it('reports the child in agent terms, never Idle, and says its total once it is done', () => {
    const { rerender } = render(<SubagentProvenanceToolRow {...settled({ running: true })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('working')
    // A working child says it with the row's spinner; the record row has no clock.
    expect(screen.getByText('subagentPreviewKind · Long child')).not.toBeNull()
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: true, settledMs: 302_400 })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('finished')
    // Council round 23, item 1: the outcome ends the row, after the model; the title stays the task.
    expect(screen.getByText('subagentPreviewKind · Long child')).not.toBeNull()
    expect(ending()).toBe('subagentPreviewFinished · 5m 02s')
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: false })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('interrupted')
    expect(ending()).toBe('subagentPreviewInterrupted')
    rerender(<SubagentProvenanceToolRow {...settled({})} />)
    expect(previewRoot()?.getAttribute('data-state')).not.toBe('idle')
    expect(document.body.textContent).not.toMatch(/idle/iu)
  })

  it('leads a working row with the Working ring and ends it with the live clock, never the call duration (council round 23, item 1)', () => {
    // The rows read "Audit other rounding call sites  gpt-6-luna  1s": the call's own duration, which reads as finished.
    const since = Date.now() - 26_000
    render(<SubagentProvenanceToolRow {...settled({ running: true, since })} />)
    expect(leadingStatus()).toBe('working')
    const accessory = screen.getByTestId('header-accessory')
    const clock = accessory.querySelector('[data-live-elapsed]')
    expect(clock?.getAttribute('role')).toBe('timer')
    expect(clock?.className).toContain('dshx:tabular-nums')
    // The clock ends the row, after the model.
    expect(accessory.lastElementChild).toBe(clock)
    // The row prints its own time: tool-meta draws no call duration beside a card that carries this mark.
    expect(document.querySelector('[data-dshfiles-subagent-row]')?.getAttribute('data-tool-card-timing')).toBe('own')
  })

  it('leads a starting call with the Working ring and a settled one with the agent mark', () => {
    const { rerender } = render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', description: 'Audit' })} />)
    expect(leadingStatus()).toBe('working')
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: true, settledMs: 2_000 })} />)
    expect(screen.getByTestId('leading').querySelector('[data-slot="status-glyph"]')).toBeNull()
    expect(document.querySelector('[data-live-elapsed]')).toBeNull()
  })

  it('says Failed for a child whose turn failed, and keeps Stopped for one the user stopped (round 21 D4)', () => {
    // The provider refused the child's turn: `subagentTiming` says only that it did not complete.
    failedTurns.set(CHILD, { sessionId: CHILD, failedAt: 1, reason: 'error' })
    const { rerender } = render(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: false })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('failed')
    // Council round 22, item 2: the red cross leads, the title is the task, "Turn failed" ends the row in failed ink.
    expect(screen.getByText('subagentPreviewKind · Long child')).not.toBeNull()
    expect(screen.getByTestId('leading').querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('failed')
    const failure = screen.getByTestId('header-accessory').querySelector('[data-subagent-failure]')
    expect(failure?.textContent).toBe('threadSidebarFailed')
    expect(failure?.className).toContain('dshx:text-destructive')
    failedTurns.clear()
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: false, preview: previewBindings() })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('interrupted')
    expect(ending()).toBe('subagentPreviewInterrupted')
    // A stopped child is no failure: its mark stays the agent's, and nothing reads in failed ink.
    expect(screen.getByTestId('leading').querySelector('[data-slot="status-glyph"]')).toBeNull()
    expect(document.querySelector('[data-subagent-failure]')).toBeNull()
  })

  it('reads how the turn ended from the open child\'s own events, as DSH writes them (round 21 D4)', async () => {
    // A real `turn/end` carries `{ kind }`; the feed read it as a string, so an open preview said Stopped for every end.
    const events = [{ type: 'event', event: { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } } }]
    const eventSource = {
      getSnapshot: () => ({ entries: events, hasMore: false, revision: 0, change: { kind: 'replace', entries: events } }),
      subscribe: () => () => undefined,
    }
    // SAFETY: the preview reads only the event source of the binding.
    const ready = Promise.resolve({ eventSource, session: { cancel: vi.fn() } } as never)
    const preview = previewBindings({ retainChild: () => ({ ready, release: vi.fn() }) })
    render(<SubagentProvenanceToolRow {...settled({ expanded: true, preview })} />)
    await waitFor(() => expect(previewRoot()?.getAttribute('data-state')).toBe('finished'))
  })

  it('follows the child core names by its handle, through the parent catalog', () => {
    // Core answers `started subagent agent-1`: the handle, not the session id, so the row read an unknown session as Idle.
    render(<SubagentProvenanceToolRow {...settled({ running: true, resultText: 'started subagent agent-1' })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('working')
  })

  it('shows the failure of a call that started no child', () => {
    render(<SubagentProvenanceToolRow {...settled({ isError: true, expanded: true })} />)
    expect(previewRoot()).toBeNull()
    expect(screen.getByText('subagentPreviewKind')).not.toBeNull()
    expect(screen.getByTestId('leading').querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('failed')
    expect(screen.getByTestId('header-accessory').querySelector('[data-subagent-failure="failed-to-start"]')?.textContent).toBe('subagentRowNotStarted')
    expect(screen.getByTestId('expanded-content').textContent).toContain('no route')
  })

  it('opens the child only while expanded, and releases it on collapse', async () => {
    const release = vi.fn()
    const retainChild = vi.fn(() => ({ ready: new Promise<never>(() => undefined), release }))
    const preview = previewBindings({ retainChild })
    const { rerender, unmount } = render(<SubagentProvenanceToolRow {...settled({ running: true, preview })} />)
    expect(retainChild).not.toHaveBeenCalled()
    rerender(<SubagentProvenanceToolRow {...settled({ running: true, preview, expanded: true })} />)
    expect(retainChild).toHaveBeenCalledOnce()
    rerender(<SubagentProvenanceToolRow {...settled({ running: true, preview })} />)
    await waitFor(() => expect(release).toHaveBeenCalledOnce())
    unmount()
    expect(release).toHaveBeenCalledOnce()
  })

  it('names the owning thread and offers it even when live progress failed', async () => {
    const preview = previewBindings({ retainChild: () => ({ ready: Promise.reject(new Error('gone')), release: vi.fn() }) })
    render(<SubagentProvenanceToolRow {...settled({ expanded: true, preview })} />)
    await screen.findByText('subagentPreviewUnavailable')
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewOpenThread' }))
    expect(preview.openChild).toHaveBeenCalledWith(CHILD)
  })

  it('stops a working child only after confirmation', async () => {
    const cancel = vi.fn(async () => ({ ok: true }))
    const eventSource = {
      getSnapshot: () => ({ entries: [], hasMore: false, revision: 0, change: { kind: 'replace', entries: [] } }),
      subscribe: () => () => undefined,
    }
    // SAFETY: the preview reads only these two fields of the binding.
    const ready = Promise.resolve({ eventSource, session: { cancel } } as never)
    const preview = previewBindings({ retainChild: () => ({ ready, release: vi.fn() }) })
    render(<SubagentProvenanceToolRow {...settled({ running: true, expanded: true, preview })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'subagentPreviewStop' }))
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewKeepWorking' }))
    fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewStop' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'subagentPreviewConfirmStop' }))
      await Promise.resolve()
    })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
