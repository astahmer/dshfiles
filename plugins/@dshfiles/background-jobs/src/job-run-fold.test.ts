import { describe, expect, it } from 'vitest'
import { jobFoldStatus } from './job-run-fold.js'

describe('jobFoldStatus', () => {
  it('maps the job lifecycle onto the fold vocabulary', () => {
    expect(jobFoldStatus({ status: 'running' })).toBe('working')
    expect(jobFoldStatus({ status: 'stopping' })).toBe('working')
    expect(jobFoldStatus({ status: 'completed' })).toBe('done')
    expect(jobFoldStatus({ status: 'killed' })).toBe('stopped')
    expect(jobFoldStatus({ status: 'failed' })).toBe('failed')
  })

  it('counts a command that exited non-zero as failed, and exit 0 as done', () => {
    expect(jobFoldStatus({ status: 'completed', detail: 'exit code: 3' })).toBe('failed')
    expect(jobFoldStatus({ status: 'completed', detail: 'exit code: 0' })).toBe('done')
  })
})
