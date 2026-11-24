// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { SubagentCatalogAction, SubagentHeaderLineage, type SubagentHeaderLineageProps } from './SubagentHeaderLineage.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineRegular: () => null,
  IconChevronRightOutlineRegular: () => null,
  IconRefreshOutlineRegular: () => null,
  StateDot: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// SAFETY: fixture ids only need SessionId's brand; no Host validates them.
const PARENT = 'parent' as SessionId
// SAFETY: fixture ids only need SessionId's brand; no Host validates them.
const CHILD = 'child' as SessionId
const unavailable = (): never => {
  throw new Error('Unexpected dependency use in lineage fixture')
}
const translate: SubagentHeaderLineageProps['t'] = (key, params) => {
  if (key === 'activity.running') return 'Running'
  if (key === 'count.total.one') return `${String(params?.count ?? '')} subagent`
  if (key === 'count.total.other') return `${String(params?.count ?? '')} subagents`
  if (key === 'count.running.one' || key === 'count.running.other') return `${String(params?.count ?? '')} running`
  return key
}

const childSummary: SessionSummary = {
  id: CHILD,
  displayTitle: 'worker',
  running: false,
  retainedBy: {},
  blank: false,
  updatedAt: 1,
  parentId: PARENT,
  origin: 'subagent',
  projectionValues: { threadSidebarModelRoute: 'openai/gpt-6.1-luna' },
}

const sessionList: SessionListState = {
  ids: [CHILD],
  byId: { [CHILD]: childSummary },
  phase: 'ready',
  projectionsBySession: {
    [PARENT]: {
      state: 'ready',
      error: null,
      values: {
        subagentCatalog: [{ id: CHILD, mode: 'continuable', label: 'worker', createdAt: 1 }],
      },
    },
  },
}

const sessionListWithRunningSubagents = (): SessionListState => {
  // SAFETY: synthetic fixture ids only need SessionId's brand; no Host validates them.
  const entries = Array.from({ length: 34 }, (_, index) => ({
    id: `child-${index + 1}` as SessionId,
    mode: 'continuable' as const,
    label: `worker-${index + 1}`,
    createdAt: index + 1,
  }))
  const byId = entries.reduce<Record<string, SessionSummary>>((summaries, entry, index) => {
    summaries[entry.id] = {
      ...childSummary,
      id: entry.id,
      displayTitle: entry.label,
      running: index < 2,
    }
    return summaries
  }, {})

  return {
    ids: entries.map(entry => entry.id),
    byId,
    phase: 'ready',
    projectionsBySession: {
      [PARENT]: {
        state: 'ready',
        error: null,
        values: { subagentCatalog: entries },
      },
    },
  }
}

const session: SessionSnapshot = {
  sessionId: CHILD,
  pendingSubmissions: [],
  running: false,
  subagent: { address: { parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' } },
  removed: false,
  openState: 'open',
  openError: null,
  hasMore: false,
  loadingOlder: false,
  historyWasPartial: false,
  historyLoadStatus: 'idle',
  promptError: null,
  blank: false,
  lastAgentError: null,
  promptAttempted: false,
  awaitingFirstTurn: false,
}

const props = (): SubagentHeaderLineageProps => ({
  usePanelInfo: unavailable,
  useResource: unavailable,
  useAccess: unavailable,
  useContextMenu: unavailable,
  useSessionRetainInfo: unavailable,
  useWorkspaces: unavailable,
  useProjection: (key: Parameters<SubagentHeaderLineageProps['useProjection']>[0]) => (key === 'threadSidebarModelRoute' ? 'openai/gpt-6.1-luna' : undefined),
  useConversation: unavailable,
  useInput: unavailable,
  useChat: unavailable,
  inputActions: {
    captureInsertion: unavailable,
    insertText: unavailable,
    insertQuote: unavailable,
    setDraft: unavailable,
    persistDraft: unavailable,
    addAttachments: unavailable,
    removeAttachment: unavailable,
    pruneAttachments: unavailable,
    submit: unavailable,
  },
  useRemoteAccess: unavailable,
  useSessionAccess: unavailable,
  useWorkspaceAccess: unavailable,
  useSessions: select => select(sessionList),
  useSession: select => select(session),
  useSessionStatus: <T,>(select: (snapshot: SessionStatusSnapshot) => T): T => select(new Map()),
  openChild: vi.fn(),
  openChildAside: vi.fn(),
  refreshProjection: vi.fn(),
  copy: { count: count => `${String(count)} ${count === 1 ? 'subagent' : 'subagents'}`, working: 'Working', done: 'Done', stopped: 'Stopped' },
  sessionId: CHILD,
  lineageSessionId: CHILD,
  displayTitle: 'worker',
  t: translate,
})

afterEach(cleanup)

describe('SubagentHeaderLineage route provenance', () => {
  it('keeps the route in the child header, out of the catalog row', () => {
    render(<SubagentHeaderLineage {...props()} />)

    expect(screen.getByText('openai/gpt-6.1-luna')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'switcher.aria' }))
    expect(screen.getAllByText(/openai\/gpt-6\.1-luna/)).toHaveLength(1)
  })

  it('counts the subagents in its own words, with the spinner while one works and no "2/34"', () => {
    const state = sessionListWithRunningSubagents()
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(state)} />)

    const trigger = screen.getByRole('button', { name: '34 subagents · Working' })
    expect(trigger.textContent).toBe('34 subagents')
    expect(trigger.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('working')

    fireEvent.click(trigger)
    const activeRow = screen.getByRole('treeitem', { name: /^worker-1 · Working/ })
    const inactiveRow = screen.getByRole('treeitem', { name: /^worker-3$/ })
    expect(activeRow.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('working')
    expect(inactiveRow.querySelector('[data-slot="status-glyph"]')).toBeNull()
  })

  it('shows a finished 300 s child as Done for 5m 00s, with no token count and no raw prompt', () => {
    // The row read "[[once call bash {\"command\":\"sleep 300\"…", "0 tok" and a duration from core's own formatter.
    const finished: SessionListState = {
      ...sessionList,
      byId: {
        [CHILD]: {
          ...childSummary,
          title: '[[once call bash {"command":"sleep 300"}]]',
          projectionValues: {
            ...childSummary.projectionValues,
            subagentTiming: { settledMs: 300_000, lastTurnCompleted: true },
            tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      },
    }
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(finished)} />)
    fireEvent.click(screen.getByRole('button', { name: '1 subagent' }))
    const row = screen.getByRole('treeitem', { name: 'worker · Done · 5m 00s' })
    expect(row.textContent).toContain('5m 00s')
    expect(row.textContent).not.toMatch(/tok|once call/u)
    expect(row.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('done')
  })

  it('hovers the catalog open and closed with its delays, and a click pins it open', () => {
    vi.useFakeTimers()
    try {
      render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(sessionList)} />)
      const trigger = screen.getByRole('button', { name: /subagent/ })

      fireEvent.mouseOver(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      act(() => {
        vi.advanceTimersByTime(150)
      })
      expect(trigger.getAttribute('aria-expanded')).toBe('true')

      fireEvent.mouseOut(trigger, { relatedTarget: document.body })
      act(() => {
        vi.advanceTimersByTime(120)
      })
      expect(trigger.getAttribute('aria-expanded')).toBe('false')

      fireEvent.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      fireEvent.mouseOut(trigger, { relatedTarget: document.body })
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(trigger.getAttribute('aria-expanded')).toBe('true')

      fireEvent.pointerDown(document.body)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the catalog whose rows show a duration without an ambient tooltip provider', () => {
    const timed: SessionListState = {
      ...sessionList,
      byId: { [CHILD]: { ...childSummary, projectionValues: { ...childSummary.projectionValues, subagentTiming: { settledMs: 65_000 } } } },
    }
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(timed)} />)

    fireEvent.click(screen.getByRole('button', { name: /subagent/ }))
    const row = screen.getByRole('treeitem', { name: /^worker/ })
    expect(row.textContent).toContain('1m 05s')
  })
})
