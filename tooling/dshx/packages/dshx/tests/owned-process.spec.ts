import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { spawnOwnedProcess, stopOwnedProcess } from '../src/project/owned-process.js'

describe('owned process groups', () => {
  it('stops the host and descendants it started', async () => {
    if (process.platform === 'win32') return
    const child = spawnOwnedProcess(
      process.execPath,
      [
        '-e',
        "import { spawn } from 'node:child_process'; spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); setInterval(() => {}, 1000)",
      ],
      { stdio: 'ignore' },
    )
    await once(child, 'spawn')
    const pid = child.pid
    if (pid === undefined) throw new Error('owned child has no process id')
    await stopOwnedProcess(child, 1_000)
    expect(() => process.kill(-pid, 0)).toThrow()
  })
})
