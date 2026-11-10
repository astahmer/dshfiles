import { isSetupOpen, type SetupTaskView } from '@dshfiles/project-checks/workspace-setup'
import type { WorkspaceSetup } from './api.js'

/** How long a first turn may wait for a flagged setup action before it sends anyway. */
export const SETUP_WAIT_TIMEOUT_MS = 5 * 60_000
/** A queued setup task is polled at this interval while the first turn waits for it. */
export const SETUP_POLL_INTERVAL_MS = 1_000

export const setupWaitsForRun = (setup: WorkspaceSetup): boolean =>
  setup.applies && setup.awaitsFirstTurn && setup.tasks.some((task: SetupTaskView) => isSetupOpen(task.status))

/**
 * Polls a dispatched setup until nothing it must wait for is still open. Bounded: a setup that never finishes must not
 * hold the first turn forever, and its durable task keeps running (and stays cancellable) after the send.
 */
export const awaitWorkspaceSetup = async (input: {
  readonly read: () => Promise<WorkspaceSetup>
  readonly signal: AbortSignal
  readonly now: () => number
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>
  readonly timeoutMs?: number
}): Promise<'settled' | 'timed-out' | 'aborted'> => {
  const deadline = input.now() + (input.timeoutMs ?? SETUP_WAIT_TIMEOUT_MS)
  for (;;) {
    if (input.signal.aborted) return 'aborted'
    if (!setupWaitsForRun(await input.read())) return 'settled'
    if (input.now() >= deadline) return 'timed-out'
    await input.wait(SETUP_POLL_INTERVAL_MS, input.signal)
  }
}
