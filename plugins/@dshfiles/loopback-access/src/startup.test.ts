import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { ConfigEditor } from '@deepseek-ai/dsh-config-editor'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import { captureNetworkPreferences, Config, type Config as StartupConfig } from './startup.js'

describe('immutable network startup provider', () => {
  it('uses native volatile references with inheritance defaults', () => {
    const config = Config({})
    expect(captureNetworkPreferences(config)).toMatchObject({ host: null, port: null, localhostEnabled: true })
    expect(Config.meta.volatile).toBe(true)
    expect(Config.type).toBe('transform')
  })

  it('reads the section reference only once when capturing the boot plan', () => {
    const config = Config({ lanEnabled: true, bindAddress: '192.0.2.10', port: 0 })
    const observed: StartupConfig = { get: vi.fn(() => config.get()) }
    const boot = captureNetworkPreferences(observed)
    expect(boot).toMatchObject({ host: '192.0.2.10', port: 0 })
    expect(observed.get).toHaveBeenCalledTimes(1)
  })

  it('rejects incomplete LAN settings in the native Config validator', () => {
    expect(() => Config({ lanEnabled: true, bindAddress: null })).toThrow('Choose an interface address')
    expect(() => Config({ lanEnabled: true })).toThrow('Choose an interface address')
  })

  it('commits desired volatile changes without reactivating or changing the boot service', async () => {
    const ctx = new Context()
    const loaderFiber = ctx.plugin(Loader)
    await loaderFiber.await()
    const loader = ctx.loader
    const activations = vi.fn()
    let activeConfig: StartupConfig | undefined
    loader.builtins['network-startup-test'] = {
      Config,
      apply(child: Context, config: StartupConfig) {
        activations()
        activeConfig = config
        child.provide('dshfilesNetworkStartup', captureNetworkPreferences(config))
      },
    }
    try {
      const id = await loader.create({
        name: 'cordis:network-startup-test',
        config: { lanEnabled: true, bindAddress: '192.0.2.10', port: 3080, localhostEnabled: true },
      })
      await loader.await()
      expect(activations).toHaveBeenCalledTimes(1)
      const boot = ctx.dshfilesNetworkStartup
      const entry = loader.resolve(id)
      const fiber = entry.fiber
      // Supply only profile-layer reads; discovery and revision tracking use the real native SettingsForms.
      ctx.provide('profileContext', {
        name: 'network-startup-test',
        dir: '/__dsh_network_startup_test__',
        patchPath: '/__dsh_network_startup_test__/cordis.patch.yml',
        installAnchor: '/__dsh_network_startup_test__/package.json',
        cwd: '/__dsh_network_startup_test__',
        home: '/__dsh_network_startup_test__',
        startedBundles: [],
        overlays: [],
        telemetryDisabledEnv: undefined,
      })
      const editor = new ConfigEditor(ctx)
      vi.spyOn(editor, 'entries').mockReturnValue([entry])
      vi.spyOn(editor, 'configuration').mockImplementation(() => [{ entry, inherited: {}, override: entry.options.config ?? {} }])
      const settings = new SettingsForms(ctx)
      const initial = settings.describe().find(descriptor => descriptor.ns === id)
      expect(initial).toBeDefined()
      expect(initial?.value).toMatchObject({ lanEnabled: true, bindAddress: '192.0.2.10', port: 3080 })
      await loader.update(id, {
        config: { lanEnabled: true, bindAddress: '192.0.2.11', port: 3198, localhostEnabled: false },
      })
      await loader.await()
      expect(activeConfig?.get()).toMatchObject({ bindAddress: '192.0.2.11', port: 3198, localhostEnabled: false })
      const changed = settings.describe().find(descriptor => descriptor.ns === id)
      expect(changed?.value).toMatchObject({ bindAddress: '192.0.2.11', port: 3198, localhostEnabled: false })
      expect(changed?.revision).toBe((initial?.revision ?? 0) + 1)
      expect(fiber).toBeDefined()
      // Fiber's public update validates before its restart waterfall; ConfigEditor uses the same schema before saving.
      expect(() => fiber?.update({ lanEnabled: true, bindAddress: null }, true)).toThrow('Choose an interface address')
      expect(activeConfig?.get()).toMatchObject({ bindAddress: '192.0.2.11', port: 3198, localhostEnabled: false })
      expect(activations).toHaveBeenCalledTimes(1)
      expect(entry.fiber).toBe(fiber)
      expect(ctx.dshfilesNetworkStartup).toBe(boot)
      expect(boot).toMatchObject({ host: '192.0.2.10', port: 3080, localhostEnabled: true })
      expect(Object.isFrozen(boot)).toBe(true)
      expect(Object.isFrozen(boot.preferences)).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
