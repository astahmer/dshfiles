import type { Prerequisite } from './catalog-model.js'
import type { Overview } from './overview-model.js'

/** The checklist items the wizard's own steps set up (Account, then Project); First task has none. */
export const WIZARD_PREREQUISITES = ['account', 'project', 'repository'] as const satisfies readonly Prerequisite[]

export type FirstRunSetup = 'pending' | 'open' | 'done'

/**
 * dshfiles fork default: the wizard opens by itself only while what it walks through is still missing, so a profile
 * that already has an AI account and a project (an existing user in a new browser) never gets it on its own. A
 * failed or slow read (no answer within `waitMs`) or a checklist turned off keeps upstream's behaviour (open).
 */
export class FirstRun {
  static readonly waitMs = 3_000

  static readonly setup = (input: { readonly overview: Overview | undefined; readonly failed: boolean }): FirstRunSetup => {
    if (input.failed) return 'open'
    if (input.overview === undefined) return 'pending'
    const checklist = input.overview.checklist
    if (checklist === null) return 'open'
    return WIZARD_PREREQUISITES.every(id => checklist.find(item => item.id === id)?.state === 'done') ? 'done' : 'open'
  }
}
