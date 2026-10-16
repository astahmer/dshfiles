import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { stopOwnedProcess, spawnOwnedProcess } from '../../packages/dshx/src/project/owned-process.js'
import { createScratchHostLifecycle, type ScratchHostInstance } from './scratch-host-lifecycle.js'

const children: ChildProcess[] = []
let token = 0

const startProcess = async (port: number): Promise<ScratchHostInstance> => {
  const host = spawnOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  children.push(host)
  await new Promise<void>((resolve, reject) => {
    if (host.pid !== undefined) {
      resolve()
      return
    }
    host.once('spawn', resolve)
    host.once('error', reject)
  })
  token += 1
  return { host, port, url: `http://127.0.0.1:${String(port)}/token-${String(token)}`, output: () => '' }
}

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return
      await stopOwnedProcess(child)
    }),
  )
})

describe('scratch Host process lifecycle', () => {
  it('restarts only its owned child, refreshes the URL, and retains profile state until close', async () => {
    const initial = await startProcess(31_993)
    let disposals = 0
    const lifecycle = createScratchHostLifecycle({ initial, start: startProcess, dispose: async () => void (disposals += 1) })
    const firstUrl = lifecycle.url
    const firstHost = lifecycle.host

    const freshUrl = await lifecycle.restart()

    expect(freshUrl).toBe(lifecycle.url)
    expect(freshUrl).not.toBe(firstUrl)
    expect(lifecycle.host).not.toBe(firstHost)
    expect(lifecycle.port).toBe(31_993)
    expect(firstHost.exitCode !== null || firstHost.signalCode !== null).toBe(true)
    expect(disposals).toBe(0)

    await lifecycle.close()
    await lifecycle.close()
    expect(disposals).toBe(1)
    expect(() => lifecycle.host).toThrow('The scratch Host is not running.')
    await expect(lifecycle.restart()).rejects.toThrow('The scratch profile has been disposed.')
  })

  it('serializes teardown behind an in-flight restart and leaves no owned child running', async () => {
    const initial = await startProcess(31_994)
    let current: ScratchHostInstance | undefined = initial
    let disposals = 0
    const lifecycle = createScratchHostLifecycle({
      initial,
      start: async port => {
        current = await startProcess(port)
        return current
      },
      dispose: async () => void (disposals += 1),
    })

    const restart = lifecycle.restart()
    const close = lifecycle.close()
    await Promise.all([restart, close])

    expect(disposals).toBe(1)
    expect(current?.host.exitCode !== null || current?.host.signalCode !== null).toBe(true)
  })
})
