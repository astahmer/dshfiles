import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

export const waitForManagedExit = async ({
  handle,
  timeoutMs,
  signal,
}: {
  handle: Pick<SubprocessHandle, 'waitForExit'>
  timeoutMs: number
  signal?: AbortSignal
}): Promise<boolean> => {
  const deadline = AbortSignal.timeout(timeoutMs)
  try {
    return await handle.waitForExit(signal === undefined ? deadline : AbortSignal.any([signal, deadline]))
  } catch {
    return false
  }
}

export const terminateManagedProcess = async ({
  handle,
  timeoutMs,
}: {
  handle: Pick<SubprocessHandle, 'waitForExit' | 'terminate'>
  timeoutMs: number
}): Promise<boolean> => {
  handle.terminate()
  return waitForManagedExit({ handle, timeoutMs })
}
