import { watch, type FSWatcher } from 'node:fs'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { safeCordisLogger } from './safe-logger.js'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, Fiber, Inject } from '@deepseek-ai/cordis'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { HostRuntimeModel, type HostPluginMetadata } from './runtime.js'
import { hostGenerationManifestSchema, HOST_GENERATION_DIRECTORY } from './generation-contract.js'
import {
  activateGeneration,
  attemptGeneration,
  beginGenerationSwap,
  closeGeneration,
  closedGeneration,
  commitGenerationSwap,
  initialGenerationStore,
  isGenerationClosed,
  mountedGeneration,
  settleGenerationSwap,
} from './generation-state.js'
import { decodeJson, jsonValueSchema } from '../json.js'

/** The Loader and lifecycle surface one generation must provide. */
export interface HostGenerationImplementation {
  readonly name: string
  readonly inject?: Inject
  readonly Config?: StandardSchemaV1
  readonly apply: (ctx: Context, config?: unknown) => unknown
}

const applySchema = Schema.declare<HostGenerationImplementation['apply']>(
  (value): value is HostGenerationImplementation['apply'] => typeof value === 'function',
)

const generationModuleSchema = Schema.Struct({
  implementation: Schema.Struct({
    name: Schema.String.check(Schema.isMinLength(1)),
    inject: Schema.optional(Schema.Union([Schema.Array(Schema.String), Schema.Record(Schema.String, Schema.Unknown)])),
    Config: Schema.optional(Schema.Unknown),
    apply: applySchema,
  }),
})

export interface HostGenerationPluginOptions {
  readonly implementation: HostGenerationImplementation
  readonly metadata: HostPluginMetadata
  readonly generation: string
  readonly hostContractVersion: string
  readonly manifestUrl: URL
}

interface ActiveGeneration {
  readonly id: string
  readonly implementation: HostGenerationImplementation
  readonly fiber: Fiber
}

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 2_000)
}

const serializeInjection = (inject: Inject | undefined): string | undefined => {
  try {
    return JSON.stringify(inject)
  } catch {
    return undefined
  }
}

/** A fully synchronous teardown resolves `dispose()` to `undefined`, so never chain onto it. */
const disposeFiber = async (fiber: Fiber): Promise<void> => {
  await fiber.dispose()
}

const mountImplementation = async (context: Context, implementation: HostGenerationImplementation, config: unknown): Promise<Fiber> => {
  const plugin = {
    name: implementation.name,
    ...(implementation.inject !== undefined && { inject: implementation.inject }),
    apply: (childContext: Context) => implementation.apply(childContext, config),
  }
  const fiber = context.plugin(plugin)
  try {
    await fiber
  } catch (error) {
    await disposeFiber(fiber).catch(() => undefined)
    throw error
  }
  return fiber
}

export const createHostGenerationPlugin = (options: HostGenerationPluginOptions): HostGenerationImplementation => ({
  name: options.implementation.name,
  ...(options.implementation.inject !== undefined && { inject: options.implementation.inject }),
  ...(options.implementation.Config !== undefined && { Config: options.implementation.Config }),
  async apply(context, config) {
    let store = initialGenerationStore<ActiveGeneration>()
    let watcher: FSWatcher | undefined
    let updateQueue = Promise.resolve()
    const logger = safeCordisLogger(context, 'dshx:host-hmr')

    const fail = (generation: string, error: unknown): void => {
      logger.error('Host generation failed (plugin=%s generation=%s): %s', options.metadata.packageId, generation, errorMessage(error))
    }
    const contractChanged = (generation: string, detail: string): void => {
      logger.error(
        `Host ${detail} changed (plugin=%s generation=%s); update dev.hostHmr.hostContractVersion and restart DSH`,
        options.metadata.packageId,
        generation,
      )
    }

    const mount = async (implementation: HostGenerationImplementation, id: string): Promise<ActiveGeneration> => ({
      id,
      implementation,
      fiber: await mountImplementation(context, implementation, config),
    })

    const unmount = async (target: ActiveGeneration): Promise<boolean> => {
      try {
        await disposeFiber(target.fiber)
        return true
      } catch (error) {
        fail(target.id, error)
        return false
      }
    }

    const restore = async (target: ActiveGeneration): Promise<ActiveGeneration | undefined> => {
      try {
        const restored = await mount(target.implementation, target.id)
        logger.warn('Restored Host generation (plugin=%s generation=%s)', options.metadata.packageId, target.id)
        return restored
      } catch (error) {
        fail(target.id, error)
        return undefined
      }
    }

    const decodeCandidate = (imported: unknown, generation: string): HostGenerationImplementation | undefined => {
      const decodedModule = Schema.decodeUnknownOption(generationModuleSchema)(imported)
      if (Option.isNone(decodedModule)) {
        logger.error('Invalid Host generation module (plugin=%s generation=%s)', options.metadata.packageId, generation)
        return undefined
      }
      const candidate = decodedModule.value.implementation
      if (candidate.name !== options.implementation.name) {
        contractChanged(generation, 'Loader name')
        return undefined
      }
      if (serializeInjection(candidate.inject) !== serializeInjection(options.implementation.inject)) {
        contractChanged(generation, 'Loader inject')
        return undefined
      }
      const config = candidate.Config
      if ((config !== undefined) !== (options.implementation.Config !== undefined)) {
        contractChanged(generation, 'Loader Config')
        return undefined
      }
      if (config !== undefined && !HostRuntimeModel.isStandardSchema(config)) {
        logger.error('Invalid Host generation Config schema (plugin=%s generation=%s)', options.metadata.packageId, generation)
        return undefined
      }
      return {
        name: candidate.name,
        ...(candidate.inject !== undefined && { inject: candidate.inject }),
        ...(config !== undefined && { Config: config }),
        apply: candidate.apply,
      }
    }

    const activate = async (generation: string): Promise<void> => {
      const generationUrl = new URL(`${HOST_GENERATION_DIRECTORY}/${generation}.js`, options.manifestUrl)
      let imported: unknown
      try {
        imported = await import(generationUrl.href)
      } catch (error) {
        fail(generation, error)
        return
      }
      const candidate = decodeCandidate(imported, generation)
      if (candidate === undefined || isGenerationClosed(store)) return

      const previous = mountedGeneration(store)
      store = beginGenerationSwap(store, generation)
      if (previous !== undefined) {
        if (!(await unmount(previous))) {
          store = settleGenerationSwap(store, previous)
          return
        }
      }
      if (isGenerationClosed(store)) return
      try {
        const mounted = await mount(candidate, generation)
        if (isGenerationClosed(store)) {
          await unmount(mounted)
          return
        }
        store = commitGenerationSwap(store, mounted)
        logger.info('Host generation activated (plugin=%s generation=%s)', options.metadata.packageId, generation)
      } catch (error) {
        fail(generation, error)
        if (previous === undefined || isGenerationClosed(store)) {
          store = settleGenerationSwap(store, undefined)
          return
        }
        store = settleGenerationSwap(store, await restore(previous))
      }
    }

    const refresh = async (): Promise<void> => {
      let rawManifest: string
      try {
        rawManifest = await readFile(fileURLToPath(options.manifestUrl), 'utf8')
      } catch (error) {
        fail(options.generation, error)
        return
      }
      const decodedManifest = Schema.decodeUnknownOption(hostGenerationManifestSchema, { onExcessProperty: 'error' })(decodeJson(jsonValueSchema, rawManifest))
      if (Option.isNone(decodedManifest)) {
        logger.error('Invalid Host generation manifest (plugin=%s)', options.metadata.packageId)
        return
      }
      const manifest = decodedManifest.value
      // One attempt per revision: a failed generation must not loop until its content changes.
      const recorded = attemptGeneration(store, manifest.generation)
      if (recorded === undefined) return
      store = recorded
      if (manifest.hostContractVersion !== options.hostContractVersion) {
        contractChanged(manifest.generation, 'contract version')
        return
      }
      await activate(manifest.generation)
    }

    const scheduleRefresh = (): void => {
      if (isGenerationClosed(store)) return
      updateQueue = updateQueue
        .then(async () => {
          if (!isGenerationClosed(store)) await refresh()
        })
        .catch(error => fail(options.generation, error))
    }

    // Ownership is registered before the first await: Cordis settles `await fiber`
    // ahead of an async plugin body, so a disposal during startup must still find
    // this effect and tear the mounted generation down.
    context.effect(
      () => async () => {
        store = closeGeneration(store)
        watcher?.close()
        await updateQueue
        const remaining = closedGeneration(store)
        if (remaining !== undefined) await unmount(remaining)
      },
      'dshx:host-generation',
    )

    const initial = await mount(options.implementation, options.generation)
    if (isGenerationClosed(store)) {
      await unmount(initial)
      return
    }
    store = activateGeneration(store, initial)
    const manifestPath = fileURLToPath(options.manifestUrl)
    watcher = watch(dirname(manifestPath), (_event, filename) => {
      if (filename !== null && filename.toString() !== basename(manifestPath)) return
      scheduleRefresh()
    })
    watcher.on('error', error => fail(options.generation, error))
    if (isGenerationClosed(store)) {
      watcher.close()
      const remaining = closedGeneration(store)
      if (remaining !== undefined) await unmount(remaining)
      return
    }
    scheduleRefresh()
  },
})
