import type { CloneJob, CloneStage } from './project-lifecycle-api.js'

export const clonePhaseLabels = {
  cloning: 'Cloning',
  colocating: 'Setting up jj',
  registering: 'Adding the project',
  done: 'Done',
} satisfies Record<CloneJob['phase'], string>

export const cloneStageLabels = {
  connecting: 'Connecting',
  counting: 'Counting objects',
  receiving: 'Receiving objects',
  resolving: 'Resolving deltas',
  checkout: 'Checking out files',
} satisfies Record<CloneStage, string>

/** One line naming what the clone is doing, without the path or the raw git message. */
export const cloneStepLabel = (job: CloneJob): string =>
  `${clonePhaseLabels[job.phase]}${job.state === 'running' && job.progress.stage !== null ? ` · ${cloneStageLabels[job.progress.stage]}` : ''}`
