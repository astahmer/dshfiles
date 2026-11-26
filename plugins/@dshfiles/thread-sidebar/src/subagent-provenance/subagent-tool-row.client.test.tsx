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
    title,
    collapsedContent,
    headerAccessory,
    open,
    children,
  }: {
    title: string
    collapsedContent?: ReactNode
    headerAccessory?: ReactNode
    open: boolean
    children?: ReactNode
  }) => (
    <div>
      <div>{title}</div>
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
    byId: { [CHILD]: { projectionValues: { subagentTiming: { lastTurnCompleted: input.lastTurnCompleted, settledMs: input.settledMs } } } },
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

  it('keeps an empty mark seat for a model with no known family, so names share one start edge (round 21 D5)', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'dshx_fake_commandcode', model: 'step-5-preview', description: 'Review currency conversion' })} />)
    const model = screen.getByTestId('header-accessory').querySelector('[data-slot="route-model"]')
    expect(model?.textContent).toBe('step-5-preview')
    expect(model?.firstElementChild?.getAttribute('data-model-mark')).toBe('none')
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
    expect(screen.getByText('subagentPreviewKind · Long child · subagentPreviewFinished · 5m 02s')).not.toBeNull()
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: false })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('interrupted')
    expect(screen.getByText('subagentPreviewKind · Long child · subagentPreviewInterrupted')).not.toBeNull()
    rerender(<SubagentProvenanceToolRow {...settled({})} />)
    expect(previewRoot()?.getAttribute('data-state')).not.toBe('idle')
    expect(document.body.textContent).not.toMatch(/idle/iu)
  })

  it('says Failed for a child whose turn failed, and keeps Stopped for one the user stopped (round 21 D4)', () => {
    // The provider refused the child's turn: `subagentTiming` says only that it did not complete.
    failedTurns.set(CHILD, { sessionId: CHILD, failedAt: 1, reason: 'error' })
    const { rerender } = render(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: false })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('failed')
    expect(screen.getByText('subagentPreviewKind · Long child · subagentPreviewFailed')).not.toBeNull()
    failedTurns.clear()
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: false, preview: previewBindings() })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('interrupted')
    expect(screen.getByText('subagentPreviewKind · Long child · subagentPreviewInterrupted')).not.toBeNull()
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
    expect(screen.getByText('subagentPreviewKind · subagentPreviewFailedToStart')).not.toBeNull()
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
