import { isAbsolute, relative, sep } from 'node:path'
import { z } from 'zod'

export const projectActionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).default(''),
    command: z.string().trim().min(1).max(2048),
    args: z.array(z.string().max(2048)).max(64).default([]),
    root: z.string().trim().min(1).max(2048).refine(isAbsolute, 'Use an absolute trusted project root.'),
    timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
    verifyBeforeComplete: z.boolean().default(false),
  })
  .strict()

export const projectChecksConfigSchema = z
  .object({
    actions: z.array(projectActionSchema).max(32).default([]),
    maxVerificationAttempts: z.number().int().min(1).max(2).default(2),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>()
    value.actions.forEach((action, index) => {
      if (ids.has(action.id)) {
        context.addIssue({ code: 'custom', path: ['actions', index, 'id'], message: 'Project action ids must be unique.' })
      }
      ids.add(action.id)
    })
  })
  .default({ actions: [], maxVerificationAttempts: 2 })

export type ProjectAction = z.infer<typeof projectActionSchema>
export type ProjectChecksConfig = z.infer<typeof projectChecksConfigSchema>

export interface VerificationFailure {
  readonly label: string
  readonly status: 'failed' | 'cancelled' | 'timed-out'
  readonly exitCode: number | null
  readonly failure: string | null
}

export class ProjectChecksModel {
  static readonly isWithinRoot = (root: string, cwd: string): boolean => {
    if (!isAbsolute(root) || !isAbsolute(cwd)) return false
    const pathFromRoot = relative(root, cwd)
    return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  }

  static readonly receiptFreshness = (receiptRevision: string | null, currentRevision: string | null): 'current' | 'stale' | 'unknown' => {
    if (receiptRevision === null || currentRevision === null) return 'unknown'
    return receiptRevision === currentRevision ? 'current' : 'stale'
  }

  static readonly verificationPrompt = (failures: readonly VerificationFailure[], attempt: number, maxAttempts: number): string => {
    const failed = failures
      .slice(0, 6)
      .map(
        item => `${item.label} (${item.status}${item.exitCode === null ? '' : `, exit ${item.exitCode}`}${item.failure === null ? '' : `, ${item.failure}`})`,
      )
      .join(', ')
    const extra = failures.length > 6 ? `, and ${failures.length - 6} more` : ''
    return `Project checks failed (${failed}${extra}). Fix the reported checks, then stop again for verification. Attempt ${attempt} of ${maxAttempts}. Do not claim completion while these checks fail.`
  }
}
