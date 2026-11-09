import { isAbsolute, relative, sep } from 'node:path'
import { Effect, Schema } from 'effect'

const remoteIdPattern = /^[a-z0-9][a-z0-9-]{0,31}$/u
const sshTargetPattern = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/u
const shellWord = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
const intBetween = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum))
const trimmed = (minimum: number, maximum: number) => Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const absolutePath = (maximum: number, message: string) =>
  Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maximum),
    Schema.makeFilter(value => (isAbsolute(value) ? undefined : message), { message }),
  )

const executionPolicySchema = Schema.Struct({
  target: Schema.Literals(['local', 'remote', 'auto']).pipe(Schema.withDecodingDefaultKey(Effect.succeed('local'))),
  remote: Schema.optionalKey(Schema.String.check(Schema.isPattern(remoteIdPattern))),
  onRemoteFailure: Schema.Literals(['local', 'fail']).pipe(Schema.withDecodingDefaultKey(Effect.succeed('local'))),
}).pipe(Schema.withDecodingDefaultKey(Effect.succeed({ target: 'local', onRemoteFailure: 'local' })))

const loadPolicySchema = Schema.Struct({
  localMemoryFloorMb: intBetween(0, 1_048_576).pipe(Schema.withDecodingDefaultKey(Effect.succeed(4_096))),
  remoteCooldownMs: intBetween(1_000, 600_000).pipe(Schema.withDecodingDefaultKey(Effect.succeed(60_000))),
}).pipe(Schema.withDecodingDefaultKey(Effect.succeed({ localMemoryFloorMb: 4_096, remoteCooldownMs: 60_000 })))

const projectActionSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/u)),
  label: trimmed(1, 80),
  description: trimmed(0, 240).pipe(Schema.withDecodingDefaultKey(Effect.succeed(''))),
  command: trimmed(1, 2048),
  args: Schema.Array(Schema.String.check(Schema.isMaxLength(2048)))
    .check(Schema.isMaxLength(64))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  root: absolutePath(2048, 'Use an absolute trusted project root.'),
  timeoutMs: intBetween(1_000, 300_000).pipe(Schema.withDecodingDefaultKey(Effect.succeed(60_000))),
  verifyBeforeComplete: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  replayPolicy: Schema.Literals(['manual', 'read-only']).pipe(Schema.withDecodingDefaultKey(Effect.succeed('manual'))),
  /** Run this action once in a new thread workspace of this project, through the durable task queue. */
  runOnWorkspaceCreate: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** Hold the first send of a new thread until this action finishes; only meaningful with `runOnWorkspaceCreate`. */
  awaitBeforeFirstTurn: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** Run this action when a thread of this project settles. */
  onSettle: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  execution: executionPolicySchema,
})

export const remoteHostSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(remoteIdPattern)),
  sshTarget: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(255),
    Schema.isPattern(sshTargetPattern, { message: 'Use an ssh destination such as user@host.' }),
  ),
  /** Name of the local jj remote that points at this peer's bare snapshot repository. */
  gitRemote: trimmed(1, 64).check(Schema.isPattern(/^[A-Za-z0-9._-]+$/u)),
  /** Name of the peer repository's remote that points back at the same bare repository. */
  peerRemote: trimmed(1, 64)
    .check(Schema.isPattern(/^[A-Za-z0-9._-]+$/u))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed('origin'))),
  workspace: absolutePath(2048, 'Use an absolute peer checker workspace path.'),
  /** Prefix that pins the peer toolchain for action and install commands, e.g. ['mise', 'exec', 'node@22.23.3', '--']. */
  toolchain: Schema.Array(shellWord)
    .check(Schema.isMaxLength(8))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  install: Schema.optionalKey(
    Schema.Struct({
      command: Schema.Array(shellWord).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
      whenPaths: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)))
        .check(Schema.isMinLength(1), Schema.isMaxLength(16))
        .pipe(Schema.withDecodingDefaultKey(Effect.succeed(['pnpm-lock.yaml', 'pnpm-workspace.yaml']))),
      timeoutMs: intBetween(1_000, 900_000).pipe(Schema.withDecodingDefaultKey(Effect.succeed(300_000))),
    }),
  ),
  priority: intBetween(1, 99).pipe(Schema.withDecodingDefaultKey(Effect.succeed(1))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
})

const configCheck = Schema.makeFilter((value: typeof projectChecksConfigShape.Type) => {
  const issues: Array<{ readonly path: ReadonlyArray<PropertyKey>; readonly issue: string }> = []
  const actionIds = new Set<string>()
  value.actions.forEach((action, index) => {
    if (actionIds.has(action.id)) issues.push({ path: ['actions', index, 'id'], issue: 'Project action ids must be unique.' })
    actionIds.add(action.id)
  })
  const remoteIds = new Set<string>()
  value.remotes.forEach((remote, index) => {
    if (remoteIds.has(remote.id)) issues.push({ path: ['remotes', index, 'id'], issue: 'Project check remote ids must be unique.' })
    remoteIds.add(remote.id)
  })
  value.actions.forEach((action, index) => {
    const policy = action.execution
    if (policy.remote !== undefined && !remoteIds.has(policy.remote)) {
      issues.push({ path: ['actions', index, 'execution', 'remote'], issue: 'This execution policy names an unknown remote.' })
    }
    if (policy.target === 'remote' && policy.remote === undefined && value.remotes.every(remote => !remote.enabled)) {
      issues.push({ path: ['actions', index, 'execution', 'target'], issue: 'A remote execution target needs at least one enabled remote.' })
    }
    if (action.awaitBeforeFirstTurn && !action.runOnWorkspaceCreate) {
      issues.push({
        path: ['actions', index, 'awaitBeforeFirstTurn'],
        issue: 'Waiting before the first turn needs runOnWorkspaceCreate: nothing else would start this action.',
      })
    }
    if ((action.runOnWorkspaceCreate || action.onSettle) && action.execution.target !== 'local') {
      issues.push({
        path: ['actions', index, 'runOnWorkspaceCreate'],
        issue: 'A setup action runs through the durable local queue; set execution.target to local.',
      })
    }
  })
  return issues
})

const projectChecksConfigShape = Schema.Struct({
  actions: Schema.Array(projectActionSchema)
    .check(Schema.isMaxLength(32))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  maxVerificationAttempts: intBetween(1, 2).pipe(Schema.withDecodingDefaultKey(Effect.succeed(2))),
  remotes: Schema.Array(remoteHostSchema)
    .check(Schema.isMaxLength(8))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  load: loadPolicySchema,
})

export const projectChecksConfigSchema = projectChecksConfigShape
  .check(configCheck)
  .pipe(
    Schema.withDecodingDefault(
      Effect.succeed({ actions: [], maxVerificationAttempts: 2, remotes: [], load: { localMemoryFloorMb: 4_096, remoteCooldownMs: 60_000 } }),
    ),
  )

export type ProjectAction = typeof projectActionSchema.Type
export type RemoteHost = typeof remoteHostSchema.Type
export type ExecutionPolicy = typeof executionPolicySchema.Type
export type LoadPolicy = typeof loadPolicySchema.Type
export type ProjectChecksConfig = typeof projectChecksConfigSchema.Type

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
