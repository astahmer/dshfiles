import type { ChildProcess } from 'node:child_process'
import { stopOwnedProcess } from '../../packages/dshx/src/project/owned-process.js'

export interface ScratchHostInstance {
  readonly host: ChildProcess
  readonly port: number
  readonly url: string
  output(): string
}

export interface ScratchHostLifecycle {
  readonly host: ChildProcess
  readonly port: number
  readonly url: string
  output(): string
  restart(): Promise<string>
  close(): Promise<void>
}

export const createScratchHostLifecycle = (input: {
  readonly initial: ScratchHostInstance
  readonly start: (port: number) => Promise<ScratchHostInstance>
  readonly dispose: () => Promise<void>
}): ScratchHostLifecycle => {
  let current: ScratchHostInstance | undefined = input.initial
  let currentPort = input.initial.port
  let disposed = false
  let operation: Promise<void> = Promise.resolve()

  const serialize = <Value>(task: () => Promise<Value>): Promise<Value> => {
    const result = operation.then(task, task)
    operation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const requireCurrent = (): ScratchHostInstance => {
    if (current === undefined) throw new Error('The scratch Host is not running.')
    return current
  }

  const stopCurrent = async (host: ChildProcess): Promise<void> => {
    if (host.exitCode !== null || host.signalCode !== null) return
    await stopOwnedProcess(host)
  }

  return {
    get host() {
      return requireCurrent().host
    },
    get port() {
      return currentPort
    },
    get url() {
      return requireCurrent().url
    },
    output: () => current?.output() ?? '',
    restart: () =>
      serialize(async () => {
        if (disposed) throw new Error('The scratch profile has been disposed.')
        const previous = current
        if (previous !== undefined) {
          currentPort = previous.port
          current = undefined
          await stopCurrent(previous.host)
        }
        current = await input.start(currentPort)
        currentPort = current.port
        return current.url
      }),
    close: () =>
      serialize(async () => {
        if (disposed) return
        disposed = true
        const previous = current
        current = undefined
        try {
          if (previous !== undefined) await stopCurrent(previous.host)
        } finally {
          await input.dispose()
        }
      }),
  }
}
