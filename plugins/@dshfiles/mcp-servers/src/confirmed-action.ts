/** Run a destructive action only after the caller confirms it. */
export const runAfterConfirmation = async <T>(confirm: () => boolean, operation: () => Promise<T>): Promise<T | undefined> => {
  if (!confirm()) return undefined
  return operation()
}
