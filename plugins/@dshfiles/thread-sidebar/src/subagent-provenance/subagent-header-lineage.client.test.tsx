// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { SubagentCatalogAction, SubagentHeaderLineage, type SubagentHeaderLineageProps } from './SubagentHeaderLineage.js'

/** The Host's failed-turn record the menu reads (round 21 D4); a test fills it per case. */
const failedTurns = vi.hoisted(() => new Map<string, { readonly sessionId: string; readonly failedAt: number; readonly reason: 'error' | 'max-tokens' }>())
vi.mock('./subagent-failed-turns.js', () => ({ useSubagentFailedTurns: () => failedTurns }))
// The live-turns read needs the Host API; the child's state line reads its step and start from it.
vi.mock('../live-activity.js', async original => ({
  ...(await original<typeof import('../live-activity.js')>()),
  useLiveTurns: (ids: readonly string[]) => new Map(ids.map(id => [id, { step: undefined, startedAt: 1_000, needsYou: false }])),
}))

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
  copy: {
    count: count => `${String(count)} ${count === 1 ? 'subagent' : 'subagents'}`,
    summary: {
      working: count => `${String(count)} working`,
      failed: count => `${String(count)} failed`,
      stopped: count => `${String(count)} stopped`,
      done: count => `${String(count)} done`,
    },
    working: 'Working',
    needsYou: 'Needs you',
    done: 'Done',
    stopped: 'Stopped',
    failed: 'Failed',
  },
  sessionId: CHILD,
  lineageSessionId: CHILD,
  displayTitle: 'worker',
  t: translate,
})

afterEach(() => {
  cleanup()
  failedTurns.clear()
})

describe('SubagentHeaderLineage route provenance', () => {
  it('keeps the model in the child header as the kit mark and name, out of the catalog row (council round 17 B1.1)', () => {
    const { container } = render(<SubagentHeaderLineage {...props()} />)

    const model = container.querySelector('[data-slot="route-model"]')
    expect(model?.textContent).toBe('gpt-6.1-luna')
    expect(model?.querySelector('[data-model-mark="openai"]')).not.toBeNull()
    // The provider id is not a name to show, and the badge carries no native hover title.
    expect(container.textContent).not.toContain('openai/')
    expect(container.querySelector('[title]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'switcher.aria' }))
    expect(document.querySelectorAll('[data-slot="route-model"]')).toHaveLength(1)
  })

  it('says a running child\'s state right after its model, not in the header\'s middle (council round 22, item 7)', () => {
    const running: SessionListState = { ...sessionList, byId: { [CHILD]: { ...childSummary, running: true } } }
    const { container } = render(<SubagentHeaderLineage {...props()} useSessions={select => select(running)} />)
    const model = container.querySelector('[data-subagent-route]')
    const state = container.querySelector('[data-subagent-live-state]')
    if (model === null || state === null) throw new Error('no model or no live state in the child header')
    // Document order: the model, then its state.
    expect(model.compareDocumentPosition(state)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(state.querySelector('[data-testid="thread-header-live-activity"]')?.textContent).toContain('Working')
    // An idle child names no state there.
    cleanup()
    const idle = render(<SubagentHeaderLineage {...props()} />)
    expect(idle.container.querySelector('[data-subagent-live-state]')).toBeNull()
  })

  it('shows no model while no route names one: no mark, no guess', () => {
    const { container } = render(<SubagentHeaderLineage {...props()} useProjection={() => undefined} />)
    expect(container.querySelector('[data-slot="route-model"]')).toBeNull()
  })

  it('counts the subagents with the one formula, with the spinner while one works and no "2/34"', () => {
    const state = sessionListWithRunningSubagents()
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(state)} />)

    // Council round 22, item 3: `2 working`, never "34 subagents"; the 32 with no known state count in no part.
    const trigger = screen.getByRole('button', { name: '2 working' })
    expect(trigger.textContent).toBe('2 working')
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
    fireEvent.click(screen.getByRole('button', { name: '1 done' }))
    const row = screen.getByRole('treeitem', { name: 'worker · Done · 5m 00s' })
    expect(row.textContent).toContain('5m 00s')
    expect(row.textContent).not.toMatch(/tok|once call/u)
    expect(row.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('done')
  })

  it('shows a child whose turn failed as Failed, and keeps Stopped for one the user stopped (round 21 D4)', () => {
    const ended: SessionListState = {
      ...sessionList,
      byId: { [CHILD]: { ...childSummary, projectionValues: { ...childSummary.projectionValues, subagentTiming: { settledMs: 0, lastTurnCompleted: false } } } },
    }
    failedTurns.set(CHILD, { sessionId: CHILD, failedAt: 1, reason: 'error' })
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(ended)} />)
    fireEvent.click(screen.getByRole('button', { name: '1 failed' }))
    const failed = screen.getByRole('treeitem', { name: /^worker · Failed/ })
    expect(failed.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('failed')
    cleanup()
    failedTurns.clear()
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(ended)} />)
    fireEvent.click(screen.getByRole('button', { name: '1 stopped' }))
    const stopped = screen.getByRole('treeitem', { name: /^worker · Stopped/ })
    expect(stopped.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('stopped')
  })

  it('hovers the catalog open and closed with its delays, and a click pins it open', () => {
    vi.useFakeTimers()
    try {
      render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(sessionList)} />)
      const trigger = screen.getByRole('button', { name: '1 subagent' })

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

  it('reads `N working · M failed` with the failed clause in failed ink (council round 22, item 3)', () => {
    const state = sessionListWithRunningSubagents()
    failedTurns.set('child-3', { sessionId: 'child-3', failedAt: 1, reason: 'error' })
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(state)} />)
    const trigger = screen.getByRole('button', { name: '2 working · 1 failed' })
    const failed = [...trigger.querySelectorAll('span')].find(span => span.textContent === ' · 1 failed')
    expect(failed?.className).toMatch(/countFailed/)
  })
})
