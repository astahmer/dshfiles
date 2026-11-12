import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RunFoldKind, RunFoldMemberState, RunFoldStatus } from '@dshfiles/chat/run-folds'
import { BotIcon } from '@dshfiles/plugin-ui/icons'
import { useMemo } from 'react'
import { SubagentFeedModel, type SubagentPreviewState } from './subagent-feed.js'
import { subagentStateLabel, type SubagentPreviewTranslate } from './subagent-live-preview.js'

/** The subagent row's states on the transcript's status vocabulary; a child that failed to start is the problem. */
const STATUS = {
  starting: 'working',
  'failed-to-start': 'failed',
  working: 'working',
  finished: 'done',
  idle: 'done',
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
  useStates: ({ calls, runtime }) => {
    const children = calls.map(call => (call.phase === 'result' && !call.isError ? (SubagentFeedModel.childIdOfResult(call.resultText) ?? '') : ''))
    const key = children.join(SEPARATOR)
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
    const phases = calls.map(call => `${call.phase}:${String(call.isError)}`).join(SEPARATOR)
    return useMemo((): readonly RunFoldMemberState[] => {
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
        const state = SubagentFeedModel.stateOf({
          phase: callPhase === 'preparing' || callPhase === 'start' ? callPhase : 'result',
          failed: error === 'true',
          childId: child === '' ? undefined : child,
          running: flags.includes('r'),
          lastTurnCompleted: turn === '' || turn === undefined ? undefined : turn === 'true',
        })
        return { status: STATUS[state] }
      })
    }, [key, live, turns, phases])
  },
  useText: () => ({
    count: input.count,
    active: subagentStateLabel(input.t, 'working').toLocaleLowerCase(),
    done: subagentStateLabel(input.t, 'finished').toLocaleLowerCase(),
  }),
})
