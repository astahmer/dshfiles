import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RunFoldKind, RunFoldMemberState, RunFoldStatus } from '@dshfiles/chat/run-folds'
import { BotIcon } from '@dshfiles/plugin-ui/icons'
import { useMemo } from 'react'
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

const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['subagent', 'subagent_fork'])
const SEPARATOR = '\n'

/**
 * Subagent delegations as a transcript fold kind (b:7rv2): Chat folds two or more consecutive rows into
 * "3 subagents · 2 working · 1 finished". A child waiting on the user (a pending question or approval) is Needs you and
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
        return { status: state === undefined ? 'done' : STATUS[state] }
      })
    }, [key, live, turns, failed, phases])
  },
  useText: () => ({
    count: input.count,
    active: subagentStateLabel(input.t, 'working').toLocaleLowerCase(),
    done: subagentStateLabel(input.t, 'finished').toLocaleLowerCase(),
  }),
})
