import { Schema } from 'effect'
import { createContext } from './context.js'
import { loadPlugin } from './load-plugin.js'
import type { Registration, UnsupportedRecord } from './unsupported.js'

export interface Entry {
  readonly specifier: string
  readonly options: string
  readonly enabled: boolean
}

export interface PluginStatus {
  readonly specifier: string
  id: string | null
  state: 'loaded' | 'failed' | 'disabled'
  error: string | null
  readonly contributions: { readonly tools: string[]; readonly skills: string[]; readonly hooks: string[] }
  readonly unsupported: UnsupportedRecord[]
}

const optionsSchema = Schema.Record(Schema.String, Schema.Unknown)
const isCleanup = Schema.is(Schema.declare((value): value is () => unknown => typeof value === 'function'))

export const start = async (input: { readonly entries: readonly Entry[]; readonly onUnsupported: 'report' | 'fail' }) => {
  const statuses: PluginStatus[] = []
  const disposers: Array<() => Promise<void>> = []
  const ids = new Set<string>()
  for (const entry of input.entries) {
    const status: PluginStatus = {
      specifier: entry.specifier,
      id: null,
      state: entry.enabled ? 'failed' : 'disabled',
      error: null,
      contributions: { tools: [], skills: [], hooks: [] },
      unsupported: [],
    }
    statuses.push(status)
    if (!entry.enabled) continue
    const registrations: Registration[] = []
    let cleanup: (() => unknown) | undefined
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      if (cleanup !== undefined) {
        try {
          await cleanup()
        } catch {
          /* Cleanup must not prevent other disposals. */
        }
      }
      for (const registration of registrations.reverse()) {
        try {
          await registration.dispose()
        } catch {
          /* Continue disposing the remaining registrations. */
        }
      }
    }
    try {
      let options: Record<string, unknown>
      try {
        options = Schema.decodeUnknownSync(optionsSchema)(JSON.parse(entry.options))
      } catch {
        throw new Error('Invalid options JSON object. Set options to a valid JSON object in Settings › dshfiles-opencode-compat.')
      }
      const plugin = await loadPlugin({ specifier: entry.specifier })
      status.id = plugin.id
      if (ids.has(plugin.id)) throw new Error(`Duplicate plugin id ${plugin.id}. Disable or remove the duplicate in settings.`)
      ids.add(plugin.id)
      const context = createContext({
        pluginId: plugin.id,
        options,
        onUnsupported: input.onUnsupported,
        records: status.unsupported,
        register: registration => {
          let active = true
          const wrapped: Registration = {
            dispose: async () => {
              if (!active) return
              active = false
              await registration.dispose()
            },
          }
          registrations.push(wrapped)
          return wrapped
        },
      })
      const result = await plugin.setup(context)
      if (isCleanup(result)) cleanup = result
      status.state = 'loaded'
      disposers.push(dispose)
    } catch (error) {
      status.error = `${error instanceof Error ? error.message : String(error)} Check the plugin path and settings, then retry.`
      await dispose()
    }
  }
  let disposed = false
  return {
    status: () => statuses,
    dispose: async () => {
      if (disposed) return
      disposed = true
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
}
