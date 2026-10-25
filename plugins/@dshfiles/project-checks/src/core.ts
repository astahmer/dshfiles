import { isAbsolute, relative, sep } from 'node:path'
import { z } from 'zod'

const remoteIdPattern = /^[a-z0-9][a-z0-9-]{0,31}$/
const sshTargetPattern = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/
const shellWord = z.string().min(1).max(512)

export const executionPolicySchema = z
  .object({
    target: z.enum(['local', 'remote', 'auto']).default('local'),
    remote: z.string().regex(remoteIdPattern).optional(),
    onRemoteFailure: z.enum(['local', 'fail']).default('local'),
  })
  .strict()
  .default({ target: 'local', onRemoteFailure: 'local' })

export const loadPolicySchema = z
  .object({
    localMemoryFloorMb: z.number().int().min(0).max(1_048_576).default(4_096),
    remoteCooldownMs: z.number().int().min(1_000).max(600_000).default(60_000),
  })
  .strict()
  .default({ localMemoryFloorMb: 4_096, remoteCooldownMs: 60_000 })

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
    replayPolicy: z.enum(['manual', 'read-only']).default('manual'),
    execution: executionPolicySchema,
  })
  .strict()

export const remoteHostSchema = z
  .object({
    id: z.string().regex(remoteIdPattern),
    sshTarget: z.string().trim().min(1).max(255).regex(sshTargetPattern, 'Use an ssh destination such as user@host.'),
    /** Name of the local jj remote that points at this peer's bare snapshot repository. */
    gitRemote: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/),
    /** Name of the peer repository's remote that points back at the same bare repository. */
    peerRemote: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/)
      .default('origin'),
    workspace: z.string().trim().min(1).max(2048).refine(isAbsolute, 'Use an absolute peer checker workspace path.'),
    /** Prefix that pins the peer toolchain for action and install commands, e.g. ['mise', 'exec', 'node@22.23.3', '--']. */
    toolchain: z.array(shellWord).max(8).default([]),
    install: z
      .object({
        command: z.array(shellWord).min(1).max(16),
        whenPaths: z.array(z.string().min(1).max(512)).min(1).max(16).default(['pnpm-lock.yaml', 'pnpm-workspace.yaml']),
        timeoutMs: z.number().int().min(1_000).max(900_000).default(300_000),
      })
      .strict()
      .optional(),
    priority: z.number().int().min(1).max(99).default(1),
    enabled: z.boolean().default(true),
  })
  .strict()

export const projectChecksConfigSchema = z
  .object({
    actions: z.array(projectActionSchema).max(32).default([]),
    maxVerificationAttempts: z.number().int().min(1).max(2).default(2),
    remotes: z.array(remoteHostSchema).max(8).default([]),
    load: loadPolicySchema,
  })
  .strict()
  .default({ actions: [], maxVerificationAttempts: 2, remotes: [], load: { localMemoryFloorMb: 4_096, remoteCooldownMs: 60_000 } })
  .superRefine((value, context) => {
    const actionIds = new Set<string>()
    value.actions.forEach((action, index) => {
      if (actionIds.has(action.id)) {
        context.addIssue({ code: 'custom', path: ['actions', index, 'id'], message: 'Project action ids must be unique.' })
      }
      actionIds.add(action.id)
    })
    const remoteIds = new Set<string>()
    value.remotes.forEach((remote, index) => {
      if (remoteIds.has(remote.id)) {
        context.addIssue({ code: 'custom', path: ['remotes', index, 'id'], message: 'Project check remote ids must be unique.' })
      }
      remoteIds.add(remote.id)
    })
    value.actions.forEach((action, index) => {
      const policy = action.execution
      if (policy.remote !== undefined && !remoteIds.has(policy.remote)) {
        context.addIssue({ code: 'custom', path: ['actions', index, 'execution', 'remote'], message: 'This execution policy names an unknown remote.' })
      }
      if (policy.target === 'remote' && policy.remote === undefined && value.remotes.every(remote => !remote.enabled)) {
        context.addIssue({
          code: 'custom',
          path: ['actions', index, 'execution', 'target'],
          message: 'A remote execution target needs at least one enabled remote.',
        })
      }
    })
  })

export type ProjectAction = z.infer<typeof projectActionSchema>
export type RemoteHost = z.infer<typeof remoteHostSchema>
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>
export type LoadPolicy = z.infer<typeof loadPolicySchema>
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
