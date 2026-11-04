import { describe, expect, it } from 'vitest'
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
})
