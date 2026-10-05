import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

const isMissingProcess = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ESRCH'

export const spawnOwnedProcess = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess =>
  spawn(command, args, { ...options, detached: process.platform !== 'win32' })

const signalOwnedProcess = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid === undefined) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (!isMissingProcess(error)) throw error
  }
}

const processGroupExists = (pid: number): boolean => {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return !isMissingProcess(error)
  }
}

const waitForClose = (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const finish = (closed: boolean): void => {
      clearTimeout(timer)
      child.off('close', handleClose)
      resolve(closed)
    }
    const handleClose = (): void => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('close', handleClose)
  })
}

const waitForProcessGroupExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return !processGroupExists(pid)
}

export const stopOwnedProcess = async (child: ChildProcess, timeoutMs = 3_000): Promise<void> => {
  const pid = child.pid
  if (pid === undefined) return
  signalOwnedProcess(child, 'SIGTERM')
  if (process.platform !== 'win32') {
    if (!(await waitForProcessGroupExit(pid, timeoutMs))) {
      signalOwnedProcess(child, 'SIGKILL')
      await waitForProcessGroupExit(pid, timeoutMs)
    }
    await waitForClose(child, timeoutMs)
    return
  }
  if (await waitForClose(child, timeoutMs)) return
  signalOwnedProcess(child, 'SIGKILL')
  await waitForClose(child, timeoutMs)
}
