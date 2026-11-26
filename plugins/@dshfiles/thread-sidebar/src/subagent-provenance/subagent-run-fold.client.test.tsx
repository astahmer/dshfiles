// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RunFoldCall, RunFoldRuntime } from '@dshfiles/chat/run-folds'
import { threadSidebarDictionaries } from '../locales.js'
import { subagentRunFold } from './subagent-run-fold.js'
import type { SubagentPreviewTranslate } from './subagent-live-preview.js'

vi.mock('./subagent-failed-turns.js', () => ({ useSubagentFailedTurns: () => new Map() }))

const en: Readonly<Record<string, string>> = threadSidebarDictionaries.en
// SAFETY: the fixture translator reads the English table by key; the namespace's key union is not needed here.
const t = ((key: string, params?: { readonly count?: number }) => (en[key] ?? key).replace('{count}', String(params?.count ?? ''))) as SubagentPreviewTranslate

const PARENT = SessionId('parent')
const list: SessionListState = {
  ids: [],
  byId: {},
  phase: 'ready',
  projectionsBySession: { [PARENT]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: SessionId('child-1'), name: 'agent-1', mode: 'continuable', label: 'Check refund rounding', createdAt: 1 }] } } },
}
const runtime: RunFoldRuntime = {
  useSessions: select => select(list),
  useSessionStatus: <T,>(select: (snapshot: SessionStatusSnapshot) => T): T => select(new Map([[SessionId('child-1'), { running: true, pendingInteraction: undefined, completionUnread: false }]])),
}
const call = (overrides: Partial<RunFoldCall>): RunFoldCall => ({ callId: 'c', toolName: 'subagent', phase: 'result', argsRaw: '{}', resultText: undefined, isError: false, ...overrides })

describe('subagent run fold (council round 22, item 3)', () => {
  const kind = subagentRunFold({ t, count: count => `${String(count)} subagents` })

  it('marks a call that never started apart from a child whose turn failed', () => {
    const calls = [call({ callId: 'a', resultText: 'started subagent agent-1' }), call({ callId: 'b', isError: true })]
    const { result } = renderHook(() => kind.useStates({ sessionId: PARENT, calls, runtime }))
    expect(result.current).toEqual([{ status: 'working' }, { status: 'failed', notStarted: true }])
  })

  it('counts its run in calls and words a call that never started', () => {
    const { result } = renderHook(() => kind.useText())
    expect(result.current.calls?.(8)).toBe('8 calls')
    expect(result.current.calls?.(1)).toBe('1 call')
    expect(result.current.notStarted?.(1)).toBe('1 didn’t start')
  })
})
