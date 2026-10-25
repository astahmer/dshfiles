import { z } from 'zod'

const taskIdSchema = z.string().regex(/^[a-f0-9]{64}$/)
const sessionIdSchema = z.string().min(1).max(128)
const actionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
const revisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/)

export const durableTaskStatusSchema = z.enum(['queued', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'timed-out', 'unknown', 'blocked'])
export const durableAttemptStatusSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled', 'timed-out', 'unknown'])
export const durableTaskProgressSchema = z.enum(['queued', 'resolving-workspace', 'starting-process', 'recording-result', 'reconciling'])

const durableAttemptSchema = z
  .object({
    id: z.string().uuid(),
    number: z.number().int().min(1).max(100),
    status: durableAttemptStatusSchema,
    progress: durableTaskProgressSchema,
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().nullable(),
    exitCode: z.number().int().nullable(),
  })
  .strict()

export const durableTaskSchema = z
  .object({
    id: taskIdSchema,
    idempotencyKey: z.string().uuid(),
    sessionId: sessionIdSchema,
    actionId: actionIdSchema,
    handlerVersion: z.number().int().min(1).max(100),
    actionFingerprint: revisionSchema,
    cwd: z.string().min(1).max(2048),
    status: durableTaskStatusSchema,
    attempts: z.array(durableAttemptSchema).max(100),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    errorCode: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .nullable(),
  })
  .strict()

export type DurableTask = z.infer<typeof durableTaskSchema>
export type DurableAttempt = z.infer<typeof durableAttemptSchema>
export type DurableTaskStatus = z.infer<typeof durableTaskStatusSchema>
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
