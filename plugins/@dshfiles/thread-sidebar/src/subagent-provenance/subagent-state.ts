import type { UseSessions, UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { useMemo } from 'react'

/** What both seats of a subagent (the dock row and the transcript record row) know about the child. */
export interface SubagentState {
  /** The child has an open turn: the status store says so, or, before it has a baseline, the child's timing does. */
  readonly working: boolean
  /** Browser clock, epoch ms, of the open turn's start; the dock's clock. */
  readonly since: number | undefined
  /** Whether the latest closed turn completed; undefined while a turn is open or before one closed. */
  readonly lastTurnCompleted: boolean | undefined
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
  return useMemo(
    () => ({ working: running ?? since !== undefined, since, lastTurnCompleted, settledMs }),
    [running, since, lastTurnCompleted, settledMs],
  )
}
