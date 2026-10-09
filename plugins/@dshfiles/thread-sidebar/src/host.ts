import { defineHost } from '@dshfiles/dshx/host'
import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { promisify } from 'node:util'
import { threadSidebarMachineApi } from './machine-api.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { createRestartController } from './restart.js'
import { threadSidebarSettings } from './settings.js'

const restartApi = threadSidebarRestartApi.host({
  availability: ({ ctx }) => ({ available: createRestartController(ctx).available }),
  requestRestart: async ({ ctx }) => {
    try {
      return await createRestartController(ctx).request()
    } catch {
      throw new Error('Could not schedule a safe DSH restart.')
    }
  },
})

const execFileAsync = promisify(execFile)

/** The Finder computer name ("MacBook Pro de Alexandre") on macOS; elsewhere the short hostname. */
const readMachineName = async (): Promise<string> => {
  const shortHostname = hostname().replace(/\..*$/u, '')
  if (process.platform !== 'darwin') return shortHostname
  try {
    const { stdout } = await execFileAsync('scutil', ['--get', 'ComputerName'], { timeout: 1000 })
    return stdout.trim() || shortHostname
  } catch {
    return shortHostname
  }
}

let machineName: Promise<string> | undefined
const machineApi = threadSidebarMachineApi.host({
  name: async () => ({ name: await (machineName ??= readMachineName()) }),
})

export default defineHost({
  name: '@dshfiles/thread-sidebar',
  settings: [threadSidebarSettings],
  inject: ['connection'],
  apis: [restartApi, machineApi],
})
