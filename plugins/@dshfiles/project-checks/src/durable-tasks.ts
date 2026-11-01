import { Schema } from 'effect'

const taskIdSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))
const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const actionIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/u))
const revisionSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/u))
const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

/** Stored task statuses. `blocked` is terminal: the task stopped without a runnable retry. */
export const durableTaskStatusSchema = Schema.Literals([
  'queued',
  'running',
  'cancel-requested',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
  'unknown',
  'blocked',
])
export const durableAttemptStatusSchema = Schema.Literals(['running', 'succeeded', 'failed', 'cancelled', 'timed-out', 'unknown'])
export const durableTaskProgressSchema = Schema.Literals(['queued', 'resolving-workspace', 'starting-process', 'recording-result', 'reconciling'])

const durableAttemptSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  number: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  status: durableAttemptStatusSchema,
  progress: durableTaskProgressSchema,
  startedAt: countInt,
  finishedAt: Schema.NullOr(countInt),
  exitCode: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
})

export const durableTaskSchema = Schema.Struct({
  id: taskIdSchema,
  idempotencyKey: Schema.String.check(Schema.isUUID()),
  sessionId: sessionIdSchema,
  actionId: actionIdSchema,
  handlerVersion: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  actionFingerprint: revisionSchema,
  cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  status: durableTaskStatusSchema,
  attempts: Schema.Array(durableAttemptSchema).check(Schema.isMaxLength(100)),
  createdAt: countInt,
  updatedAt: countInt,
  errorCode: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/u))),
})

export type DurableTask = typeof durableTaskSchema.Type
export type DurableAttempt = typeof durableAttemptSchema.Type
export type DurableTaskStatus = typeof durableTaskStatusSchema.Type
export type DurableAttemptResult = Exclude<DurableAttempt['status'], 'running' | 'unknown'>

const terminalTaskStatus = (status: DurableTaskStatus): boolean =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'timed-out' || status === 'blocked'

const activeTaskStatus = (status: DurableTaskStatus): boolean => status === 'running' || status === 'cancel-requested'

const lastAttempt = (task: DurableTask): DurableAttempt | undefined => task.attempts[task.attempts.length - 1]

export class DurableTaskModel {
  static readonly isTerminal = terminalTaskStatus

  static readonly begin = (task: DurableTask, input: { readonly attemptId: string; readonly now: number }): DurableTask => {
    if (task.status !== 'queued') return task
    if (task.attempts.length >= 100) return { ...task, status: 'blocked', updatedAt: input.now, errorCode: 'attempt-limit' }
    const attempt: DurableAttempt = {
      id: input.attemptId,
      number: task.attempts.length + 1,
      status: 'running',
      progress: 'resolving-workspace',
      startedAt: input.now,
      finishedAt: null,
      exitCode: null,
    }
    return { ...task, status: 'running', attempts: [...task.attempts, attempt], updatedAt: input.now, errorCode: null }
  }

  static readonly progress = (
    task: DurableTask,
    input: { readonly attemptId: string; readonly progress: DurableAttempt['progress']; readonly now: number },
  ): DurableTask => {
    if (!activeTaskStatus(task.status)) return task
    const attempt = lastAttempt(task)
    if (attempt === undefined || attempt.id !== input.attemptId || attempt.status !== 'running') return task
    return {
      ...task,
      attempts: [...task.attempts.slice(0, -1), { ...attempt, progress: input.progress }],
      updatedAt: input.now,
    }
  }

  static readonly finish = (
    task: DurableTask,
    input: { readonly attemptId: string; readonly status: DurableAttemptResult; readonly exitCode: number | null; readonly now: number },
  ): DurableTask => {
    if (!activeTaskStatus(task.status)) return task
    const attempt = lastAttempt(task)
    if (attempt === undefined || attempt.id !== input.attemptId || attempt.status !== 'running') return task
    return {
      ...task,
      status: input.status,
      attempts: [...task.attempts.slice(0, -1), { ...attempt, status: input.status, finishedAt: input.now, exitCode: input.exitCode }],
      updatedAt: input.now,
      errorCode: input.status === 'succeeded' || input.status === 'cancelled' ? null : input.status,
    }
  }

  static readonly cancel = (task: DurableTask, now: number): DurableTask => {
    if (task.status === 'queued') return { ...task, status: 'cancelled', updatedAt: now }
    if (task.status !== 'running') return task
    return { ...task, status: 'cancel-requested', updatedAt: now }
  }

  static readonly unknown = (task: DurableTask, now: number): DurableTask => {
    if (!activeTaskStatus(task.status)) return task
    const attempt = lastAttempt(task)
    return {
      ...task,
      status: 'unknown',
      attempts:
        attempt === undefined || attempt.status !== 'running'
          ? task.attempts
          : [...task.attempts.slice(0, -1), { ...attempt, status: 'unknown', finishedAt: now }],
      updatedAt: now,
      errorCode: 'owner-interrupted',
    }
  }

  static readonly reconcile = (
    task: DurableTask,
    input: { readonly attemptId: string; readonly status: DurableAttemptResult; readonly exitCode: number | null; readonly now: number },
  ): DurableTask => {
    if (task.status !== 'unknown') return task
    const attempt = lastAttempt(task)
    if (attempt === undefined || attempt.id !== input.attemptId || attempt.status !== 'unknown') return task
    return {
      ...task,
      status: input.status,
      attempts: [...task.attempts.slice(0, -1), { ...attempt, status: input.status, finishedAt: input.now, exitCode: input.exitCode }],
      updatedAt: input.now,
      errorCode: input.status === 'succeeded' || input.status === 'cancelled' ? null : input.status,
    }
  }

  static readonly retry = (task: DurableTask, now: number): DurableTask => {
    if (task.status !== 'unknown' && task.status !== 'failed' && task.status !== 'timed-out' && task.status !== 'cancelled') return task
    return { ...task, status: 'queued', updatedAt: now, errorCode: null }
  }

  static readonly block = (task: DurableTask, input: { readonly errorCode: string; readonly now: number }): DurableTask => {
    if (terminalTaskStatus(task.status)) return task
    return { ...task, status: 'blocked', updatedAt: input.now, errorCode: input.errorCode }
  }
}
