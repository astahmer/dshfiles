import { describe, expect, it } from 'vitest'
import { clonePhaseLabels, cloneStageLabels, cloneStepLabel } from './clone-labels.js'
import { cloneJobsToAnnounce } from './clone-jobs-notice.js'
import type { CloneJob } from './project-lifecycle-api.js'

const job = (id: string, state: CloneJob['state'], extra: Partial<CloneJob> = {}): CloneJob => ({
  id,
  repositoryUrl: `file:///tmp/${id}`,
  path: `/tmp/${id}`,
  state,
  phase: state === 'succeeded' ? 'done' : 'cloning',
  progress: { percent: state === 'succeeded' ? 100 : 40, stage: 'checkout', message: 'Checking out files' },
  startedAt: 1,
  finishedAt: state === 'running' ? null : 2,
  workspaceId: state === 'succeeded' ? `ws-${id}` : null,
  error: state === 'failed' ? 'git clone failed.' : null,
  ...extra,
})

describe('clone notices', () => {
  it('announces running and undismissed failed clones, newest first and at most three', () => {
    const jobs = [job('a', 'running'), job('b', 'failed'), job('c', 'succeeded'), job('d', 'cancelled'), job('e', 'running')]
    expect(cloneJobsToAnnounce(jobs, []).map(entry => entry.id)).toEqual(['a', 'b', 'e'])
    expect(cloneJobsToAnnounce(jobs, ['b']).map(entry => entry.id)).toEqual(['a', 'e'])
    expect(cloneJobsToAnnounce(jobs, [])).toHaveLength(3)
    expect(cloneJobsToAnnounce([job('a', 'succeeded'), job('b', 'cancelled')], [])).toEqual([])
  })

  it('names the phase and the git stage without leaking the raw progress line', () => {
    expect(cloneStepLabel(job('a', 'running'))).toBe('Cloning · Checking out files')
    expect(cloneStepLabel(job('a', 'running', { phase: 'colocating', progress: { percent: 100, stage: 'checkout', message: 'Colocating jj' } }))).toBe(
      'Setting up jj · Checking out files',
    )
    expect(cloneStepLabel(job('a', 'failed'))).toBe('Cloning')
    expect(Object.values(clonePhaseLabels)).toContain('Done')
    expect(Object.values(cloneStageLabels)).toContain('Receiving objects')
  })
})
