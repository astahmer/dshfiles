import type { UseSessions, UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { useMemo } from 'react'
import { useSubagentFailedTurns } from './subagent-failed-turns.js'
import { SubagentFeedModel, type SubagentTerminal } from './subagent-feed.js'

/** What both seats of a subagent (the dock row and the transcript record row) know about the child. */
export interface SubagentState {
  /** The child has an open turn: the status store says so, or, before it has a baseline, the child's timing does. */
  readonly working: boolean
  /** Browser clock, epoch ms, of the open turn's start; the dock's clock. */
  readonly since: number | undefined
  /** How the latest closed turn ended (completed, failed, stopped); undefined while a turn is open or before one closed. */
  readonly terminal: SubagentTerminal | undefined
  /** Time the child worked over its closed turns; the record row's `Done · 5m 02s`. */
  readonly settledMs: number | undefined
}

/**
 * One reading of a child for every surface that draws it, from the session list's `subagentTiming` projection and the
 * status store the dock already trusts. Each selector returns a primitive, so a list update that leaves this child
 * alone does not re-render the row.
 */
export const useSubagentState = (input: {
  readonly childId: string | undefined
  readonly useSessions: UseSessions
  readonly useSessionStatus: UseSessionStatus
}): SubagentState => {
  const { childId } = input
  const running = input.useSessionStatus(statuses => (childId === undefined ? undefined : statuses.get(SessionId(childId))?.running))
  const timing = (list: Parameters<Parameters<UseSessions>[0]>[0]) =>
    childId === undefined ? undefined : list.byId[SessionId(childId)]?.projectionValues?.subagentTiming
  const since = input.useSessions(list => timing(list)?.active?.since)
  const lastTurnCompleted = input.useSessions(list => timing(list)?.lastTurnCompleted)
  const settledMs = input.useSessions(list => timing(list)?.settledMs)
  const failedTurn = useSubagentFailedTurns().has(childId ?? '')
  return useMemo(() => {
    const working = running ?? since !== undefined
    return { working, since, terminal: SubagentFeedModel.terminalOf({ running: working, failedTurn, lastTurnCompleted }), settledMs }
  }, [running, since, failedTurn, lastTurnCompleted, settledMs])
}

/**
 * How a child's latest turn ended, for a surface that draws one child and holds the session hooks (the phone header,
 * round 21 D4): `completed`, `failed` or `stopped`; undefined while it works or before a turn closed.
 */
export const useSubagentTerminal = (input: {
  readonly childId: string | undefined
  readonly useSessions: UseSessions
  readonly useSessionStatus: UseSessionStatus
}): SubagentTerminal | undefined => useSubagentState(input).terminal
