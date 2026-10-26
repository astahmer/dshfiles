import { watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, Fiber, Inject } from '@deepseek-ai/cordis'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { z } from 'zod'
import { HostRuntimeModel, type HostPluginMetadata } from './runtime.js'
import { hostGenerationManifestSchema, HOST_GENERATION_DIRECTORY } from './generation-contract.js'

/** The Loader and lifecycle surface one generation must provide. */
export interface HostGenerationImplementation {
  readonly name: string
  readonly inject?: Inject
  readonly Config?: StandardSchemaV1
  readonly apply: (ctx: Context, config?: unknown) => unknown
}

const generationModuleSchema = z.object({
  implementation: z.object({
    name: z.string().min(1),
    inject: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
    Config: z.unknown().optional(),
    apply: z.function({ input: z.tuple([z.unknown(), z.unknown().optional()]), output: z.unknown() }),
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
    let active: ActiveGeneration | undefined
    let watcher: FSWatcher | undefined
    let closed = false
    let updateChain = Promise.resolve()
    const attempted = new Set<string>()
    const logger = context.logger('dshx:host-hmr')

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

    const decodeCandidate = (imported: unknown, generation: string): HostGenerationImplementation | undefined => {
      const decodedModule = generationModuleSchema.safeParse(imported)
      if (!decodedModule.success) {
        logger.error('Invalid Host generation module (plugin=%s generation=%s)', options.metadata.packageId, generation)
        return undefined
      }
      const candidate = decodedModule.data.implementation
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
      if (candidate === undefined) return

      // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the generation to restore: the candidate replaces `active` before it is known to start.
      const previous = active
      if (previous !== undefined) {
        if (!(await unmount(previous))) return
        active = undefined
      }
      if (closed) return
      try {
        active = await mount(candidate, generation)
        logger.info('Host generation activated (plugin=%s generation=%s)', options.metadata.packageId, generation)
      } catch (error) {
        fail(generation, error)
        if (previous === undefined || closed) return
        try {
          active = await mount(previous.implementation, previous.id)
          logger.warn('Restored Host generation (plugin=%s generation=%s)', options.metadata.packageId, previous.id)
        } catch (restoreError) {
          fail(previous.id, restoreError)
        }
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
      const decodedManifest = hostGenerationManifestSchema.safeParse(JSON.parse(rawManifest) as unknown)
      if (!decodedManifest.success) {
        logger.error('Invalid Host generation manifest (plugin=%s): %s', options.metadata.packageId, decodedManifest.error.message.slice(0, 2_000))
        return
      }
      const manifest = decodedManifest.data
      // One attempt per revision: a failed generation must not loop until its content changes.
      if (manifest.generation === active?.id || attempted.has(manifest.generation)) return
      attempted.add(manifest.generation)
      if (manifest.hostContractVersion !== options.hostContractVersion) {
        contractChanged(manifest.generation, 'contract version')
        return
      }
      await activate(manifest.generation)
    }

    const scheduleRefresh = (): void => {
      if (closed) return
      updateChain = updateChain
        .then(async () => {
          if (!closed) await refresh()
        })
        .catch(error => fail(options.generation, error))
    }

    // Ownership is registered before the first await: Cordis settles `await fiber`
    // ahead of an async plugin body, so a disposal during startup must still find
    // this effect and tear the mounted generation down.
    context.effect(
      () => async () => {
        closed = true
        watcher?.close()
        await updateChain
        if (active !== undefined) await unmount(active)
        active = undefined
      },
      'dshx:host-generation',
    )

    active = await mount(options.implementation, options.generation)
    if (closed) {
      if (active !== undefined) await unmount(active)
      active = undefined
      return
    }
    const manifestPath = fileURLToPath(options.manifestUrl)
    watcher = watch(dirname(manifestPath), (_event, filename) => {
      if (filename !== null && filename.toString() !== basename(manifestPath)) return
      scheduleRefresh()
    })
    watcher.on('error', error => fail(options.generation, error))
    if (closed) {
      watcher.close()
      if (active !== undefined) await unmount(active)
      active = undefined
      return
    }
    scheduleRefresh()
  },
})
