import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import { describe, expect, it } from 'vitest'
import { JobPreviewModel } from './job-preview-model.js'

// SAFETY: fixture rows only need the fields the model reads; no registry validates the brand.
const row = (overrides: Partial<JobView>): JobView =>
  ({ id: 'bash-1a2b', kind: 'bash', label: 'sleep 20', status: 'running', startedAt: 1, output: { total: 0, earliest: 0 }, ...overrides }) as JobView

describe('JobPreviewModel.jobIdOfResult', () => {
  it('reads each native hand-over wording', () => {
    expect(JobPreviewModel.jobIdOfResult({ toolName: 'bash', text: 'started background job bash-f75a9420a5824696' })).toBe('bash-f75a9420a5824696')
    expect(JobPreviewModel.jobIdOfResult({ toolName: 'workflow', text: 'workflow "audit" started in the background as job workflow-ab12' })).toBe('workflow-ab12')
  })

  it('takes the promotion marker after output that quotes another job', () => {
    const text = 'started background job bash-0000\n[still running after 30000ms; moved to background job bash-1a2b]\nThe command keeps running in the background.'
    expect(JobPreviewModel.jobIdOfResult({ toolName: 'bash', text })).toBe('bash-1a2b')
  })

  it('ignores output that merely mentions a job and tools that do not start one', () => {
    expect(JobPreviewModel.jobIdOfResult({ toolName: 'bash', text: 'log: started background job bash-1a2b' })).toBeUndefined()
    expect(JobPreviewModel.jobIdOfResult({ toolName: 'read', text: 'started background job bash-1a2b' })).toBeUndefined()
  })
})

describe('JobPreviewModel.viewOf', () => {
  it('keeps the registry lifecycle', () => {
    expect(JobPreviewModel.viewOf(row({ status: 'killed' })).status).toBe('killed')
    expect(JobPreviewModel.isLive('stopping')).toBe(true)
    expect(JobPreviewModel.isLive('failed')).toBe(false)
  })

  it('formats elapsed time', () => {
    expect(JobPreviewModel.formatElapsed(42_000)).toBe('42s')
    expect(JobPreviewModel.formatElapsed(185_000)).toBe('3m 5s')
    expect(JobPreviewModel.formatElapsed(7_800_000)).toBe('2h 10m')
  })

  it('treats a roster frame that only moved the output offset as the same card', () => {
    const before = JobPreviewModel.viewOf(row({ output: { total: 10, earliest: 0 } }))
    const after = JobPreviewModel.viewOf(row({ output: { total: 900, earliest: 0 } }))
    expect(JobPreviewModel.sameView(before, after)).toBe(true)
    expect(JobPreviewModel.sameView(before, JobPreviewModel.viewOf(row({ progress: '3/10' })))).toBe(false)
    expect(JobPreviewModel.sameView(before, undefined)).toBe(false)
  })
})
