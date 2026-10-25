import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { DurableTaskModel, durableTaskSchema, type DurableTask } from './durable-tasks.js'

export type DurableTaskResult = { readonly status: 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'unknown'; readonly exitCode: number | null }

export type DurableTaskTable = KvTable<string, DurableTask>

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
  private readonly workers = new Map<string, Promise<void>>()
  private readonly pending = new Set<string>()
  private stopping = false
  private admission: Promise<void> = Promise.resolve()

  constructor(options: DurableTaskRunnerOptions) {
    this.options = options
  }

  async recover(): Promise<void> {
    const now = this.now()
    for (const [taskId, saved] of this.options.table.entries()) {
      let task = durableTaskSchema.parse(saved)
      if (task.id !== taskId) throw new Error('Durable Project Checks task key does not match its record identity.')
      if (task.status === 'running' || task.status === 'cancel-requested') task = DurableTaskModel.unknown(task, now)
      if (task.status === 'unknown') {
        const attempt = task.attempts[task.attempts.length - 1]
        const receipt = attempt === undefined ? null : await this.options.findReceipt(taskId, attempt.id)
        if (attempt !== undefined && receipt !== null && receipt.status !== 'unknown') {
          task = DurableTaskModel.reconcile(task, { attemptId: attempt.id, status: receipt.status, exitCode: receipt.exitCode, now })
        }
        await this.options.table.put(taskId, task)
      }
      if (task.status !== 'queued' && task.status !== 'unknown') continue
      const validation = await this.options.validate(task)
      if (!validation.runnable) {
        await this.options.table.update(taskId, current => DurableTaskModel.block(current, { errorCode: 'handler-unavailable', now: this.now() }))
        continue
      }
      if (task.status === 'unknown' && !validation.safeReplay) continue
      if (task.status === 'unknown') {
        task = DurableTaskModel.retry(task, this.now())
        await this.options.table.put(taskId, task)
      }
      this.launch(taskId)
    }
  }

  async enqueue(task: DurableTask): Promise<DurableTask> {
    return this.withAdmission(async () => {
      if (this.stopping) throw new Error('Durable Project Checks runner is stopping.')
      const existing = this.options.table.get(task.id)
      if (existing !== undefined) {
        if (existing.sessionId !== task.sessionId || existing.actionId !== task.actionId || existing.actionFingerprint !== task.actionFingerprint) {
          throw new Error('That idempotency key is already bound to a different Project Checks action.')
        }
        return existing
      }
      await this.pruneTerminalRows()
      await this.options.table.put(task.id, task)
      this.launch(task.id)
      return task
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
    if (task.status === 'cancel-requested') {
      const controller = this.active.get(taskId)
      if (controller === undefined) {
        const unknown = await this.options.table.update(taskId, current => DurableTaskModel.unknown(current, this.now()))
        return unknown
      }
      controller.abort(new Error('Project Checks task cancellation requested.'))
    }
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
      await this.options.table.update(taskId, current => DurableTaskModel.unknown(current, now))
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
    const validation = await this.validateTask(taskId)
    if (!validation.runnable) {
      await this.options.table.update(taskId, current => DurableTaskModel.block(current, { errorCode: 'handler-unavailable', now: this.now() }))
      return
    }
    const attemptId = this.options.newAttemptId()
    const task = await this.options.table.update(taskId, current => DurableTaskModel.begin(current, { attemptId, now: this.now() }))
    if (task.status !== 'running') return
    if (this.stopping) {
      await this.options.table.update(taskId, current => DurableTaskModel.unknown(current, this.now()))
      return
    }
    const controller = new AbortController()
    this.active.set(taskId, controller)
    if (this.options.table.get(taskId)?.status !== 'running') return
    const progress = async (value: DurableTask['attempts'][number]['progress']): Promise<void> => {
      await this.options.table.update(taskId, current => DurableTaskModel.progress(current, { attemptId, progress: value, now: this.now() }))
    }
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
    }
  }

  private async pruneTerminalRows(): Promise<void> {
    const entries = [...this.options.table.entries()].map(([id, task]) => ({ id, task: durableTaskSchema.parse(task) }))
    const removable = entries
      .filter(
        entry => entry.task.status === 'succeeded' || entry.task.status === 'failed' || entry.task.status === 'cancelled' || entry.task.status === 'timed-out',
      )
      .sort((left, right) => left.task.updatedAt - right.task.updatedAt)
    while (entries.length >= MAX_DURABLE_TASKS && removable.length > 0) {
      const next = removable.shift()
      if (next === undefined) break
      await this.options.table.delete(next.id)
      const index = entries.findIndex(entry => entry.id === next.id)
      if (index >= 0) entries.splice(index, 1)
    }
    if (entries.length >= MAX_DURABLE_TASKS)
      throw new Error('Durable Project Checks task history is full; resolve pending/unknown work before dispatching more.')
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
