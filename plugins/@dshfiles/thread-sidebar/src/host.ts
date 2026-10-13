import { defineHost } from '@dshfiles/dshx/host'
import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { promisify } from 'node:util'
import { z } from 'zod'
import { threadSidebarMachineApi } from './machine-api.js'
import { threadSidebarPluginUpdatesApi } from './plugin-updates-api.js'
import { createPluginUpdateWatch } from './plugin-updates.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { createRestartController, readLaunchUrl } from './restart.js'
import { threadSidebarSettings } from './settings.js'

const restartApi = threadSidebarRestartApi.host({
  availability: ({ ctx }) => ({ available: createRestartController(ctx).available }),
  launchUrl: async () => ({ url: await readLaunchUrl() }),
  requestRestart: async ({ ctx }) => {
    try {
      return await createRestartController(ctx).request()
    } catch {
      throw new Error('Could not schedule a safe DSH restart.')
    }
  },
})

const execFileAsync = promisify(execFile)

const graphIdsSchema = z.object({ entries: z.array(z.object({ id: z.string() })) })

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

let pluginUpdates: ReturnType<typeof createPluginUpdateWatch> | undefined
const pluginUpdatesApi = threadSidebarPluginUpdatesApi.host({
  pending: async () => ({ plugins: (await pluginUpdates?.pending()) ?? [] }),
})

const callable = (target: object, name: string) => {
  const member: unknown = Reflect.get(target, name)
  return typeof member === 'function' ? (...args: unknown[]): unknown => Reflect.apply(member, target, args) : undefined
}

export default defineHost({
  name: '@dshfiles/thread-sidebar',
  settings: [threadSidebarSettings],
  inject: ['connection'],
  apis: [restartApi, machineApi, pluginUpdatesApi],
  // The web Host's client module registry knows where every loaded plugin package lives; Hosts without it
  // (desktop shells, older builds) simply report no pending updates.
  setup: ctx => {
    ctx.inject(['clientModules'], scoped => {
      const registry: unknown = scoped.get('clientModules')
      if (typeof registry !== 'object' || registry === null) return
      const graph = callable(registry, 'graph')
      const clientPath = callable(registry, 'clientPath')
      const onGraphChanged = callable(registry, 'onGraphChanged')
      if (graph === undefined || clientPath === undefined) return
      const watch = createPluginUpdateWatch({
        ids: () =>
          graphIdsSchema
            .catch({ entries: [] })
            .parse(graph())
            .entries.map(entry => entry.id),
        clientPath: id => {
          const path = clientPath(id)
          return typeof path === 'string' ? path : undefined
        },
      })
      watch.remember()
      scoped.effect(() => {
        pluginUpdates = watch
        const stopWatching = onGraphChanged?.(() => watch.remember())
        return () => {
          if (typeof stopWatching === 'function') Reflect.apply(stopWatching, undefined, [])
          if (pluginUpdates === watch) pluginUpdates = undefined
        }
      }, 'thread-sidebar: plugin update watch')
    })
  },
})
