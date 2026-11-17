import { describe, expect, it } from 'vitest'
import { ConversationTargets } from './conversation-targets.js'
import { LiveActivity, type ActivityEvent } from './live-activity.js'

const fold = (events: readonly ActivityEvent[]) => LiveActivity.view(events.reduce(LiveActivity.apply, LiveActivity.empty))

describe('LiveActivity', () => {
  it('keeps calls without a result, background jobs and subagents apart until they settle', () => {
    const activity = fold([
      { type: 'turn-start', turn: 1 },
      { type: 'tool-call', callId: 'a', name: 'bash', time: 10 },
      { type: 'tool-call', callId: 'b', name: 'read', time: 5 },
      { type: 'tool-result', callId: 'b' },
      { type: 'job-registered', job: { jobId: 'j1', kind: 'bash', label: 'pnpm test', startedAt: 1 } },
      { type: 'job-registered', job: { jobId: 'j2', kind: 'subagent', label: 'Review', startedAt: 2 } },
      { type: 'job-registered', job: { jobId: 'j3', kind: 'bash', label: 'pnpm build', startedAt: 3 } },
      { type: 'job-settled', jobId: 'j3' },
    ])
    expect(activity.tools.map(tool => tool.callId)).toEqual(['a'])
    expect(activity.jobs.map(job => job.jobId)).toEqual(['j1'])
    expect(activity.subagents.map(job => job.jobId)).toEqual(['j2'])
    expect(LiveActivity.summary(activity)).toBe('bash · 1 job · 1 subagent')
    expect(activity.turn).toBe(1)
  })

  it('drops calls an interrupted turn left open but keeps jobs that outlive the turn', () => {
    const activity = fold([
      { type: 'tool-call', callId: 'a', name: 'bash', time: 1 },
      { type: 'job-registered', job: { jobId: 'j1', kind: 'bash', label: 'watch', startedAt: 1 } },
      { type: 'turn-end', turn: 1 },
    ])
    expect(activity.tools).toEqual([])
    expect(activity.jobs).toHaveLength(1)
    expect(LiveActivity.isIdle(fold([]))).toBe(true)
  })

  it('drops a job whose Host died before it settled once the Session is reopened', () => {
    // The live sequence of 2026-11-13: a bash job registered, the Host died mid-step, the next Host reopened the
    // Session (`session/end-seed`) and never wrote `job/settled`, so the strip ticked for 84 h.
    const events = [
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      { type: 'tool/call', seq: 845, time: 1794532722601, data: { turn: 1, step: 132, callId: 'toolu_1', name: 'bash' } },
      {
        type: 'job/registered',
        seq: 846,
        time: 1794532722647,
        data: { jobId: 'bash-98bcf597', kind: 'bash', label: 'cd /Users/astahmer/dev/dshfiles-threads/thread-6bc461', startedAt: 1794532722600 },
      },
      { type: 'tool/result', seq: 847, time: 1794532722647, data: { turn: 1, message: { toolCallId: 'toolu_1' } } },
      { type: 'turn/end', seq: 849, time: 1794532722647, data: { turn: 1, reason: { kind: 'interrupted' } } },
      { type: 'session/end-seed', seq: 850, time: 1794562310472, data: {} },
      { type: 'turn/start', seq: 852, time: 1794562559528, data: { turn: 2 } },
    ].flatMap(event => ConversationTargets.activityEventOf(event) ?? [])
    const activity = fold(events)
    expect(activity.jobs).toEqual([])
    expect(LiveActivity.isIdle(activity)).toBe(true)
    expect(fold(events.slice(0, -2)).jobs.map(job => job.jobId)).toEqual(['bash-98bcf597'])
  })
})
