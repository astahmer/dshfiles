import type { AccountSetupController, AccountSetupRequest } from './account-setup-controller.js'

/** Accepted Host writes cannot be rolled back; cancelled intents must not start further writes or UI actions. */
export const runSetupStep = async <T>(
  controller: AccountSetupController,
  request: AccountSetupRequest,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const assertCurrent = (): void => {
    request.signal.throwIfAborted()
    if (!controller.isCurrent(request.id)) throw new Error('Setup was replaced.')
  }
  assertCurrent()
  const value = await work(request.signal)
  assertCurrent()
  return value
}
