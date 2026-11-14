/**
 * dshfiles delta: the Promise boundary between the plain-Promise native fork and the Effect
 * systemctl runner. Upstream linux-scope.ts stays Promise code; only this module runs Effects.
 */
import { Effect, ManagedRuntime, Semaphore } from 'effect'
import { failedResult, SystemctlRunner, type SystemctlRequest, type SystemctlResult } from './systemctl-runner.ts'

export type { SystemctlResult } from './systemctl-runner.ts'

/** Created on first use, closed by the runtime's teardown; a later command starts a new one. */
let runtime: ManagedRuntime.ManagedRuntime<SystemctlRunner, never> | undefined

/**
 * Run systemctl through the shared helper pool.
 * @param request - command, literal argv, complete environment and timeout.
 * @returns the exit status and output; spawn, timeout and helper failures are reported in `error`.
 */
export function runSystemctl(request: SystemctlRequest): Promise<SystemctlResult> {
  runtime ??= ManagedRuntime.make(SystemctlRunner.layer)
  // Only a runtime closed mid-command rejects; the caller sees it as a failed command.
  return runtime.runPromise(SystemctlRunner.use(runner => runner.run(request))).catch(failedResult)
}

/** Kill every helper. */
export async function closeSystemctlRunner(): Promise<void> {
  const current = runtime
  runtime = undefined
  await current?.dispose()
}

/** Promise work that runs one item at a time, in submission order (Effect semaphores are FIFO). */
export class SerialLane {
  private readonly permit = Semaphore.makeUnsafe(1)

  /** Start `work` once everything submitted earlier has settled; `work` must not reject. */
  submit(work: () => Promise<void>): void {
    Effect.runFork(this.permit.withPermit(Effect.promise(work)))
  }

  /** Settle once everything submitted so far has settled. */
  drained(): Promise<void> {
    return Effect.runPromise(this.permit.withPermit(Effect.void))
  }
}
