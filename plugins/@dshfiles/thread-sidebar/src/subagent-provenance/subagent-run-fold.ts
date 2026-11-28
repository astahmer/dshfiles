import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RunFoldKind, RunFoldMemberState, RunFoldStatus } from '@dshfiles/chat/run-folds'
import { plural } from '@dshfiles/dshx/client'
import { BotIcon } from '@dshfiles/plugin-ui/icons'
import { useMemo } from 'react'
import { SubagentRouteLabelModel } from './route-label.js'
import { useSubagentFailedTurns } from './subagent-failed-turns.js'
import { SubagentFeedModel, type SubagentPreviewState } from './subagent-feed.js'
import { subagentStateLabel, type SubagentPreviewTranslate } from './subagent-live-preview.js'

/** The subagent row's states on the transcript's status vocabulary; a child that failed to start is the problem. */
const STATUS = {
  starting: 'working',
  'failed-to-start': 'failed',
  working: 'working',
  finished: 'done',
  failed: 'failed',
  interrupted: 'stopped',
} as const satisfies Record<SubagentPreviewState, RunFoldStatus>

/** A call that never started is a problem, but no child failed: the group names it apart (council round 22, item 3). */
const memberOf = (state: SubagentPreviewState): RunFoldMemberState =>
  state === 'failed-to-start' ? { status: STATUS[state], notStarted: true } : { status: STATUS[state] }

const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['subagent', 'subagent_fork'])
const SEPARATOR = '\n'

/**
 * Subagent delegations as a transcript fold kind (b:7rv2): Chat folds two or more consecutive rows into one row that
 * reads the one count formula over every call, "8 calls · 6 working · 1 failed · 1 didn't start" (council round 22,
 * item 3). A child waiting on the user (a pending question or approval) is Needs you and
 * keeps its own row outside the fold. Reads the same Session status and list hooks as the row itself.
 */
export const subagentRunFold = (input: { readonly t: SubagentPreviewTranslate; readonly count: (count: number) => string }): RunFoldKind => ({
  id: '@dshfiles/thread-sidebar/subagent',
  order: 10,
  Icon: BotIcon,
  claims: call => SUBAGENT_TOOLS.has(call.toolName),
  useStates: ({ sessionId, calls, runtime }) => {
    const names = calls.map(call => (call.phase === 'result' && !call.isError ? (SubagentFeedModel.childNameOfResult(call.resultText) ?? '') : ''))
    const key = runtime.useSessions(list => {
      const catalog = list.projectionsBySession[sessionId]?.values.subagentCatalog
      return names.map(name => (name === '' ? '' : (SubagentFeedModel.childOf(catalog, name) ?? ''))).join(SEPARATOR)
    })
    const children = key.split(SEPARATOR)
    const live = runtime.useSessionStatus(statuses =>
      children
        .map(child => {
          if (child === '') return ''
          const status = statuses.get(SessionId(child))
          return `${status?.running === true ? 'r' : ''}${status?.pendingInteraction === undefined ? '' : 'p'}`
        })
        .join(SEPARATOR),
    )
    const turns = runtime.useSessions(list =>
      children
        .map(child => {
          const completed = child === '' ? undefined : list.byId[SessionId(child)]?.projectionValues?.subagentTiming?.lastTurnCompleted
          return completed === undefined ? '' : String(completed)
        })
        .join(SEPARATOR),
    )
    // Read without a dshx slot context: the fold runs inside Chat (round 21 D4).
    const failedTurns = useSubagentFailedTurns()
    const failed = children.map(child => (child !== '' && failedTurns.has(child) ? 'f' : '')).join(SEPARATOR)
    const phases = calls.map(call => `${call.phase}:${String(call.isError)}`).join(SEPARATOR)
    return useMemo((): readonly RunFoldMemberState[] => {
      const failedParts = failed.split(SEPARATOR)
      const liveParts = live.split(SEPARATOR)
      const turnParts = turns.split(SEPARATOR)
      return phases.split(SEPARATOR).map((phase, index): RunFoldMemberState => {
        const [callPhase = 'result', error = 'false'] = phase.split(':')
        const child = key.split(SEPARATOR)[index] ?? ''
        const flags = liveParts[index] ?? ''
        if (flags.includes('p')) return { status: 'needs-you' }
        // A result that names no child (the tool answered with text) has settled.
        if (callPhase === 'result' && error !== 'true' && child === '') return { status: 'done' }
        const turn = turnParts[index]
        const running = flags.includes('r')
        const state = SubagentFeedModel.stateOf({
          phase: callPhase === 'preparing' || callPhase === 'start' ? callPhase : 'result',
          failed: error === 'true',
          childId: child === '' ? undefined : child,
          running,
          terminal: SubagentFeedModel.terminalOf({
            running,
            failedTurn: failedParts[index] === 'f',
            lastTurnCompleted: turn === '' || turn === undefined ? undefined : turn === 'true',
          }),
        })
        // A child with no known status or closed turn yet settled as far as the fold can tell.
        return state === undefined ? { status: 'done' } : memberOf(state)
      })
    }, [key, live, turns, failed, phases])
  },
  useText: () => ({
    count: input.count,
    calls: count => plural(input.t, 'subagentCountCalls', count),
    notStarted: count => input.t('subagentCountNotStarted', { count }),
    active: subagentStateLabel(input.t, 'working').toLocaleLowerCase(),
    done: subagentStateLabel(input.t, 'finished').toLocaleLowerCase(),
  }),
  // The model a child runs on, for the notice that reports its failed run (council round 23, item 7): the same route
  // projection, then identity, the transcript row and the dock read; unknown stays unknown.
  useChildRoute: ({ childSessionId, useSessions }) => {
    const label = useSessions(list => {
      const values = list.byId[SessionId(childSessionId)]?.projectionValues
      return SubagentRouteLabelModel.displayedAgentRouteLabel(values?.threadSidebarModelRoute, values?.subagent)
    })
    return useMemo(() => SubagentRouteLabelModel.routeOf(label), [label])
  },
})
