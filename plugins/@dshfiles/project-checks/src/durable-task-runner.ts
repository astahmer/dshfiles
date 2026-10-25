import { setTimeout as delay } from 'node:timers/promises'
import { DurableTaskModel, durableTaskSchema, type DurableTask } from './durable-tasks.ts'
import type { DurableTaskExecutionStore } from './durable-task-store.ts'

export type DurableTaskResult = { readonly status: 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'unknown'; readonly exitCode: number | null }

export type DurableTaskTable = DurableTaskExecutionStore

export interface DurableTaskRunnerOptions {
  readonly table: DurableTaskTable
  readonly now?: () => number
  readonly newAttemptId: () => string
  readonly validate: (task: DurableTask) => Promise<{ readonly runnable: boolean; readonly safeReplay: boolean }>
  readonly findReceipt: (taskId: string, attemptId: string) => Promise<DurableTaskResult | null>
  readonly run: (input: {
    readonly task: DurableTask
    readonly attemptId: string
    readonly signal: AbortSignal
    readonly progress: (progress: DurableTask['attempts'][number]['progress']) => Promise<void>
  }) => Promise<DurableTaskResult>
  readonly onFailure: (error: unknown) => void
}

const MAX_DURABLE_TASKS = 1_000

export class DurableTaskRunner {
  private readonly options: DurableTaskRunnerOptions
  private readonly active = new Map<string, AbortController>()
  private readonly claimed = new Set<string>()
  private readonly workers = new Map<string, Promise<void>>()
  private readonly pending = new Set<string>()
  private stopping = false
  private admission: Promise<void> = Promise.resolve()

  constructor(options: DurableTaskRunnerOptions) {
    this.options = options
  }

  async recover(): Promise<void> {
    for (const [taskId, saved] of this.options.table.entries()) {
      const task = durableTaskSchema.parse(saved)
      if (task.id !== taskId) throw new Error('Durable Project Checks task key does not match its record identity.')
      if (task.status === 'queued' || task.status === 'running' || task.status === 'cancel-requested' || task.status === 'unknown') this.launch(taskId)
    }
  }

  async enqueue(task: DurableTask): Promise<DurableTask> {
    return this.withAdmission(async () => {
      if (this.stopping) throw new Error('Durable Project Checks runner is stopping.')
      const stored = await this.options.table.createIfAbsent(task, MAX_DURABLE_TASKS)
      if (stored.sessionId !== task.sessionId || stored.actionId !== task.actionId || stored.actionFingerprint !== task.actionFingerprint) {
        throw new Error('That idempotency key is already bound to a different Project Checks action.')
      }
      this.launch(task.id)
      return stored
    })
  }

  get(taskId: string): DurableTask | undefined {
    const task = this.options.table.get(taskId)
    return task === undefined ? undefined : durableTaskSchema.parse(task)
  }

  async list(sessionId: string): Promise<readonly DurableTask[]> {
    return [...this.options.table.entries()]
      .map(([, task]) => durableTaskSchema.parse(task))
      .filter(task => task.sessionId === sessionId)
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
      .slice(0, 100)
  }

  async cancel(taskId: string): Promise<DurableTask> {
    const task = await this.options.table.update(taskId, current => DurableTaskModel.cancel(current, this.now()))
    if (task.status === 'cancel-requested' || task.status === 'cancelled')
      this.active.get(taskId)?.abort(new Error('Project Checks task cancellation requested.'))
    return task
  }

  async retry(taskId: string, confirmPossibleDuplicate: boolean): Promise<DurableTask> {
    return this.withAdmission(async () => {
      if (!confirmPossibleDuplicate) throw new Error('Confirm possible duplicate effects before retrying this task.')
      const validation = await this.validateTask(taskId)
      if (!validation.runnable) throw new Error('The configured Project Checks handler changed or is unavailable.')
      let retryable = false
      const task = await this.options.table.update(taskId, current => {
        retryable = current.status === 'unknown' || current.status === 'failed' || current.status === 'timed-out' || current.status === 'cancelled'
        return DurableTaskModel.retry(current, this.now())
      })
      if (!retryable) throw new Error('Only failed, cancelled, timed-out or unknown tasks can be retried.')
      this.launch(taskId)
      return task
    })
  }

  async waitForIdle(): Promise<void> {
    while (this.workers.size > 0) await Promise.all(this.workers.values())
  }

  async close(): Promise<void> {
    this.stopping = true
    this.pending.clear()
    const now = this.now()
    for (const [taskId, controller] of this.active) {
      if (this.claimed.has(taskId)) await this.options.table.update(taskId, current => DurableTaskModel.unknown(current, now))
      controller.abort(new Error('Project Checks Host is stopping.'))
    }
    await this.waitForIdle()
  }

  private launch(taskId: string): void {
    if (this.stopping || this.workers.has(taskId) || this.pending.has(taskId)) return
    if (this.workers.size >= 1) {
      this.pending.add(taskId)
      return
    }
    const worker = this.runTask(taskId)
      .catch(error => this.options.onFailure(error))
      .finally(() => {
        if (this.workers.get(taskId) === worker) this.workers.delete(taskId)
        this.active.delete(taskId)
        const next = this.pending.values().next().value
        if (next !== undefined) {
          this.pending.delete(next)
          this.launch(next)
        }
      })
    this.workers.set(taskId, worker)
  }

  private async runTask(taskId: string): Promise<void> {
    const controller = new AbortController()
    this.active.set(taskId, controller)
    try {
      await this.options.table.withWorkerClaim(controller.signal, async () => {
        this.claimed.add(taskId)
        try {
          await this.runClaimedTask(taskId, controller)
        } finally {
          this.claimed.delete(taskId)
        }
      })
    } catch (error) {
      if (!controller.signal.aborted) this.options.onFailure(error)
    }
  }

  private async runClaimedTask(taskId: string, controller: AbortController): Promise<void> {
    let task = this.options.table.get(taskId)
    if (task === undefined || DurableTaskModel.isTerminal(task.status)) return
    let cancellationWasRequested = task.status === 'cancel-requested'
    if (task.status === 'running' || cancellationWasRequested) {
      task = await this.options.table.update(taskId, current => {
        if (current.status === 'cancel-requested') cancellationWasRequested = true
        return DurableTaskModel.unknown(current, this.now())
      })
      const interruptedAttempt = task.attempts[task.attempts.length - 1]
      const receipt = interruptedAttempt === undefined ? null : await this.options.findReceipt(taskId, interruptedAttempt.id)
      const receiptStatus = receipt?.status
      if (interruptedAttempt !== undefined && receipt !== null && receiptStatus !== undefined && receiptStatus !== 'unknown') {
        task = await this.options.table.update(taskId, current =>
          DurableTaskModel.reconcile(current, {
            attemptId: interruptedAttempt.id,
            status: receiptStatus,
            exitCode: receipt.exitCode,
            now: this.now(),
          }),
        )
      }
    }
    if (task.status === 'unknown') {
      const validation = await this.options.validate(task)
      if (!validation.runnable) {
        await this.options.table.update(taskId, current => DurableTaskModel.block(current, { errorCode: 'handler-unavailable', now: this.now() }))
        return
      }
      if (!validation.safeReplay || cancellationWasRequested) return
      task = await this.options.table.update(taskId, current => DurableTaskModel.retry(current, this.now()))
    }
    if (task.status !== 'queued') return
    const validation = await this.options.validate(task)
    if (!validation.runnable) {
      await this.options.table.update(taskId, current => DurableTaskModel.block(current, { errorCode: 'handler-unavailable', now: this.now() }))
      return
    }
    const attemptId = this.options.newAttemptId()
    task = await this.options.table.update(taskId, current => DurableTaskModel.begin(current, { attemptId, now: this.now() }))
    if (task.status !== 'running') return
    if (this.stopping || controller.signal.aborted) {
      await this.options.table.update(taskId, current => DurableTaskModel.unknown(current, this.now()))
      return
    }
    const progress = async (value: DurableTask['attempts'][number]['progress']): Promise<void> => {
      await this.options.table.update(taskId, current => DurableTaskModel.progress(current, { attemptId, progress: value, now: this.now() }))
    }
    const monitor = new AbortController()
    const cancellationWatcher = this.watchCancellation(taskId, controller, monitor.signal).catch(error => {
      this.options.onFailure(error)
      controller.abort(new Error('Project Checks cancellation state became unavailable.'))
    })
    try {
      const result = await this.options.run({ task, attemptId, signal: controller.signal, progress })
      await this.options.table.update(taskId, current =>
        result.status === 'unknown'
          ? DurableTaskModel.unknown(current, this.now())
          : DurableTaskModel.finish(current, { attemptId, status: result.status, exitCode: result.exitCode, now: this.now() }),
      )
    } catch (error) {
      await this.options.table.update(taskId, current => DurableTaskModel.unknown(current, this.now()))
      this.options.onFailure(error)
    } finally {
      monitor.abort()
      await cancellationWatcher
    }
  }

  private async watchCancellation(taskId: string, controller: AbortController, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !controller.signal.aborted) {
      try {
        await delay(200, undefined, { signal })
      } catch {
        return
      }
      if (this.options.table.get(taskId)?.status === 'cancel-requested') controller.abort(new Error('Project Checks task cancellation requested.'))
    }
  }

  private async validateTask(taskId: string): Promise<{ readonly runnable: boolean; readonly safeReplay: boolean }> {
    const task = this.options.table.get(taskId)
    if (task === undefined) throw new Error('No durable Project Checks task with that id.')
    return this.options.validate(durableTaskSchema.parse(task))
  }

  private async withAdmission<Result>(work: () => Promise<Result>): Promise<Result> {
    const previous = this.admission
    let release = (): void => undefined
    const locked = new Promise<void>(resolve => {
      release = resolve
    })
    this.admission = previous.then(() => locked)
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
