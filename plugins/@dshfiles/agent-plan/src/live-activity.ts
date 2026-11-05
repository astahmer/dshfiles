/** Pure model of what runs right now in one Session: open tool calls, background jobs and subagents. */

export interface RunningTool {
  readonly callId: string
  readonly name: string
  readonly startedAt: number
}

export interface LiveJob {
  readonly jobId: string
  readonly kind: string
  readonly label: string
  readonly startedAt: number
}

export interface LiveActivity {
  /** The latest turn that started, so a plan from an earlier turn can be told apart. */
  readonly turn: number | undefined
  readonly tools: readonly RunningTool[]
  readonly jobs: readonly LiveJob[]
  readonly subagents: readonly LiveJob[]
}

/** Events the strip folds, already narrowed by the Conversation Definition. */
export type ActivityEvent =
  | { readonly type: 'turn-start'; readonly turn: number }
  | { readonly type: 'turn-end'; readonly turn: number }
  | { readonly type: 'tool-call'; readonly callId: string; readonly name: string; readonly time: number }
  | { readonly type: 'tool-result'; readonly callId: string }
  | { readonly type: 'job-registered'; readonly job: LiveJob }
  | { readonly type: 'job-settled'; readonly jobId: string }

export interface ActivityState {
  readonly turn: number | undefined
  readonly tools: ReadonlyMap<string, RunningTool>
  readonly jobs: ReadonlyMap<string, LiveJob>
}

const isSubagent = (job: LiveJob): boolean => /agent/i.test(job.kind)

const EMPTY: ActivityState = { turn: undefined, tools: new Map(), jobs: new Map() }

export const LiveActivity = {
  empty: EMPTY,

  /** Apply one event; a turn boundary closes calls left without a result (an interrupted turn). */
  apply(state: ActivityState, event: ActivityEvent): ActivityState {
    switch (event.type) {
      case 'turn-start':
        return { ...state, turn: event.turn, tools: state.tools.size === 0 ? state.tools : new Map() }
      case 'turn-end':
        return state.tools.size === 0 ? state : { ...state, tools: new Map() }
      case 'tool-call': {
        const tools = new Map(state.tools)
        tools.set(event.callId, { callId: event.callId, name: event.name, startedAt: event.time })
        return { ...state, tools }
      }
      case 'tool-result': {
        if (!state.tools.has(event.callId)) return state
        const tools = new Map(state.tools)
        tools.delete(event.callId)
        return { ...state, tools }
      }
      case 'job-registered': {
        const jobs = new Map(state.jobs)
        jobs.set(event.job.jobId, event.job)
        return { ...state, jobs }
      }
      case 'job-settled': {
        if (!state.jobs.has(event.jobId)) return state
        const jobs = new Map(state.jobs)
        jobs.delete(event.jobId)
        return { ...state, jobs }
      }
    }
  },

  /** Split jobs into background work and subagents, oldest first. */
  view(state: ActivityState): LiveActivity {
    const byStart = <Row extends { readonly startedAt: number }>(rows: Iterable<Row>): Row[] =>
      [...rows].toSorted((left, right) => left.startedAt - right.startedAt)
    const jobs = byStart(state.jobs.values())
    return { turn: state.turn, tools: byStart(state.tools.values()), jobs: jobs.filter(job => !isSubagent(job)), subagents: jobs.filter(isSubagent) }
  },

  isIdle(activity: LiveActivity): boolean {
    return activity.tools.length + activity.jobs.length + activity.subagents.length === 0
  },

  /** "bash · 2 jobs · 1 subagent". */
  summary(activity: LiveActivity): string {
    const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
    const [first] = activity.tools
    return [
      first === undefined ? undefined : activity.tools.length === 1 ? first.name : `${first.name} +${activity.tools.length - 1}`,
      activity.jobs.length > 0 ? plural(activity.jobs.length, 'job', 'jobs') : undefined,
      activity.subagents.length > 0 ? plural(activity.subagents.length, 'subagent', 'subagents') : undefined,
    ]
      .filter(part => part !== undefined)
      .join(' · ')
  },
}
