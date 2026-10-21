// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  useSessionRetainInfo: unavailable,
  useWorkspaces: unavailable,
  useProjection: (key: Parameters<SubagentHeaderLineageProps['useProjection']>[0]) => (key === 'threadSidebarModelRoute' ? 'openai/gpt-6.1-luna' : undefined),
  useConversation: unavailable,
  useInput: unavailable,
  useChat: unavailable,
  inputActions: {
    captureInsertion: unavailable,
    insertText: unavailable,
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
  sessionId: CHILD,
  lineageSessionId: CHILD,
  displayTitle: 'worker',
  t: translate,
})

afterEach(cleanup)

describe('SubagentHeaderLineage route provenance', () => {
  it('shows the latest safe model route in the child header and catalog row', () => {
    render(<SubagentHeaderLineage {...props()} />)

    expect(screen.getByText('openai/gpt-6.1-luna')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'switcher.aria' }))
    expect(screen.getAllByText(/openai\/gpt-6\.1-luna/)).toHaveLength(2)
  })

  it('shows active subagents over the total and labels each working row', () => {
    const state = sessionListWithRunningSubagents()
    render(<SubagentCatalogAction {...props()} sessionId={PARENT} useSessions={select => select(state)} />)

    const trigger = screen.getByRole('button', { name: '2 running' })
    expect(trigger.textContent).toContain('2/34 subagents')

    fireEvent.click(trigger)
    const activeRow = screen.getByRole('treeitem', { name: /^worker-1 / })
    const inactiveRow = screen.getByRole('treeitem', { name: /^worker-3 / })
    expect(within(activeRow).getByRole('status').textContent).toBe('Running')
    expect(within(inactiveRow).queryByRole('status')).toBeNull()
  })
})
