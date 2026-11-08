// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { SubagentPreviewBindings } from './subagent-live-preview.js'
import { SubagentProvenanceToolRow } from './subagent-tool-row.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  DisclosureRow: ({ title, collapsedContent, open, children }: { title: string; collapsedContent?: ReactNode; open: boolean; children?: ReactNode }) => (
    <div>
      <div>{title}</div>
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
}): Props => {
  const argsRaw = JSON.stringify({ prompt, provider, model, ...(description === undefined ? {} : { description }) })
  return {
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
      argsRaw,
      args: PartialArguments.fromText(argsRaw),
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
    useSessions: selector => selector({ byId: {} } as never),
    // SAFETY: an empty status map holds nothing to misread.
    useSessionStatus: selector => selector(new Map<string, never>() as never),
    useSessionRetainInfo: unused,
    useChat: unused,
    useConversation: unused,
    useInput: unused,
    inputActions: {
      captureInsertion: unused,
      insertText: unused,
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
  }
}

const CHILD = 'child-session'

/** A settled delegation: its result only names the child. */
const settled = (input: {
  readonly expanded?: boolean
  readonly running?: boolean
  readonly lastTurnCompleted?: boolean
  readonly preview?: SubagentPreviewBindings
  readonly isError?: boolean
}): Props => {
  const base = props({ provider: 'openai', model: 'gpt-6.1-luna', expanded: input.expanded ?? false })
  if (base.phase !== 'start') throw new Error('fixture starts from the start phase')
  // SAFETY: the row reads only these fields of a settled block.
  const block = {
    call: base.block,
    content: [{ type: 'text', text: input.isError === true ? 'no route' : `started subagent ${CHILD}` }],
    isError: input.isError === true,
  } as unknown as Extract<Props, { phase: 'result' }>['block']
  const statuses = new Map([[CHILD, { running: input.running === true }]])
  const list = { byId: { [CHILD]: { projectionValues: { subagentTiming: { lastTurnCompleted: input.lastTurnCompleted } } } } }
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

afterEach(cleanup)

describe('SubagentProvenanceToolRow', () => {
  it('leads with the delegation description, then the requested provider/model', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', description: 'Review parser' })} />)
    expect(screen.getByText('Review parser · openai/gpt-6.1-luna')).not.toBeNull()
  })

  it('falls back to the first prompt line when the call has no description', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', prompt: 'Fix the flaky test\nThen report.' })} />)
    expect(screen.getByText('Fix the flaky test · openai/gpt-6.1-luna')).not.toBeNull()
  })

  it('keeps a readable generated name while the call has no text yet', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', prompt: '' })} />)
    expect(screen.getByText(/^Create subagent · [A-Z][a-z]+ [A-Z][a-z]+ · openai\/gpt-6\.1-luna$/)).not.toBeNull()
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
    expect(screen.getByText('Review this change')).not.toBeNull()
    expect(screen.queryByText(/alex@example\.com/)).toBeNull()
  })

  it('reports the child in agent terms, never the job lifecycle', () => {
    const { rerender } = render(<SubagentProvenanceToolRow {...settled({ running: true })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('working')
    // The child's state comes before the route, so a narrow pane truncates the route first.
    expect(screen.getByText('Review this change · subagentPreviewWorking · openai/gpt-6.1-luna')).not.toBeNull()
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: true })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('finished')
    rerender(<SubagentProvenanceToolRow {...settled({ lastTurnCompleted: false })} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('interrupted')
    rerender(<SubagentProvenanceToolRow {...settled({})} />)
    expect(previewRoot()?.getAttribute('data-state')).toBe('idle')
  })

  it('shows the failure of a call that started no child', () => {
    render(<SubagentProvenanceToolRow {...settled({ isError: true, expanded: true })} />)
    expect(previewRoot()).toBeNull()
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
