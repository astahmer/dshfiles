import { ToolCard } from '@dshfiles/plugin-ui/components/tool-card'
import { useState, type ReactNode } from 'react'
import { PlanProgress, type PlanItem, type PlanWrite } from './plan-progress.js'
import { PlanSteps } from './plan-steps.js'
import { useNow } from './use-now.js'

export interface PlanCallFacts {
  readonly items: readonly PlanItem[]
  readonly turn: number | undefined
  /** When the call was dispatched; with `turn` unknown (a settled row), the write at or after it names the turn. */
  readonly callTime: number | undefined
  readonly phase: 'start' | 'result'
  readonly failed: boolean
}

/**
 * Locate this call among the Session's writes: the write it produced is the first one at or after the call. Steps are
 * timed from that write's lineage; a step still in progress keeps counting only while this is the newest write and the
 * Session runs, else it freezes at the next write.
 */
export const planCardModel = (input: { readonly call: PlanCallFacts; readonly writes: readonly PlanWrite[]; readonly running: boolean }) => {
  const callTime = input.call.callTime
  const ownIndex =
    callTime === undefined ? -1 : input.writes.findIndex(write => write.time >= callTime && (input.call.turn === undefined || write.turn === input.call.turn))
  const history = ownIndex < 0 ? [] : PlanProgress.lineage(input.writes, ownIndex)
  const next = ownIndex < 0 ? undefined : input.writes[ownIndex + 1]
  const progress = PlanProgress.progress(input.call.items, history)
  const live = input.running && next === undefined && input.call.phase === 'result' && !progress.done
  return { progress, live, frozenAt: next?.time ?? history.at(-1)?.time }
}

/** `todo_write` drawn as a plan: "Step 2 of 5 · Write the tests", expanding to every step with how long it took. */
export const PlanCard = (props: {
  readonly call: PlanCallFacts
  readonly writes: readonly PlanWrite[]
  readonly running: boolean
  readonly timing: boolean
  readonly fallback: ReactNode
}): ReactNode => {
  const [open, setOpen] = useState(true)
  const { progress, live, frozenAt } = planCardModel({ call: props.call, writes: props.writes, running: props.running })
  const now = useNow(live && props.timing)
  if (props.call.failed) return props.fallback
  const clock = live ? now : (frozenAt ?? now)
  const label = PlanProgress.label(progress)
  const current = progress.done ? undefined : progress.currentStep?.content
  return (
    <div className="dshx-root" data-dshfiles-agent-plan-card="" data-plan-done={progress.done || undefined}>
      <ToolCard
        meta={`${progress.completed}/${progress.total}`}
        onToggle={() => setOpen(value => !value)}
        open={open}
        status={props.call.phase === 'start' ? 'running' : 'passed'}
        summary={current === undefined ? label : `${label} · ${current}`}
        title="Plan"
      >
        <div className="dshx:px-2 dshx:pt-1 dshx:pb-2">
          <PlanSteps now={clock} steps={progress.steps} timing={props.timing} />
        </div>
      </ToolCard>
    </div>
  )
}
