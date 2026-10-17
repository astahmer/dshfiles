import { Context, type Fiber } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HOST_GENERATION_DIRECTORY, HOST_GENERATION_MANIFEST } from '../src/host/generation-contract.js'
import { createHostGenerationPlugin } from '../src/host/generation.js'
import type { CreatedHostPlugin } from '../src/host/runtime.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
  }
}

const settle = async (): Promise<void> => {
  await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
}

const recorderKey = '__dshxGenerationEvents'

/**
 * Generated modules are loaded by the runtime manager, so they must not share a
 * module instance with the test: a vitest dynamic import of the same file can
 * resolve to a second module. `globalThis` is the one identity they do share.
 */
const generationSource = (id: string): string =>
  [
    'export const implementation = {',
    "  name: 'generation-fixture',",
    '  apply(ctx) {',
    `    globalThis.${recorderKey}.push('start:${id}')`,
    `    ctx.effect(() => () => globalThis.${recorderKey}.push('stop:${id}'), 'fixture:${id}')`,
    '  },',
    '}',
    '',
  ].join('\n')

const failingSource = (message: string): string =>
  ['export const implementation = {', "  name: 'generation-fixture',", `  apply() { throw new Error(${JSON.stringify(message)}) },`, '}', ''].join('\n')

interface GenerationHarness {
  readonly fiber: Fiber
  readonly events: readonly string[]
  publish(options: { readonly generation: string; readonly hostContractVersion?: string; readonly source: string }): Promise<void>
}

/** Mount the manager under a real Cordis fiber so child fibers and effects behave as in DSH. */
const startGeneration = async (options: { readonly generation: string; readonly source: string }): Promise<GenerationHarness> => {
  const directory = await mkdtemp(resolve(tmpdir(), 'dshx-generation-'))
  temporaryDirectories.push(directory)
  const generations = resolve(directory, HOST_GENERATION_DIRECTORY)
  await mkdir(generations, { recursive: true })
  const events: string[] = []
  Reflect.set(globalThis, recorderKey, events)
  const manifestPath = resolve(directory, HOST_GENERATION_MANIFEST)
  const manifestUrl = new URL(`./${HOST_GENERATION_MANIFEST}`, pathToFileURL(resolve(directory, 'index.js')))

  const publish = async (next: { readonly generation: string; readonly hostContractVersion?: string; readonly source: string }): Promise<void> => {
    await writeFile(resolve(generations, `${next.generation}.js`), next.source, 'utf8')
    await writeFile(manifestPath, JSON.stringify({ version: 1, generation: next.generation, hostContractVersion: next.hostContractVersion ?? 'v1' }), 'utf8')
  }

  await publish(options)
  const initial = (await import(pathToFileURL(resolve(generations, `${options.generation}.js`)).href)) as { implementation: CreatedHostPlugin }

  const manager = createHostGenerationPlugin({
    implementation: initial.implementation,
    metadata: { packageId: '@test/generation' },
    generation: options.generation,
    hostContractVersion: 'v1',
    manifestUrl,
  })
  const root = new Context()
  const fiber = root.plugin({ name: 'generation-manager', apply: (ctx: Context, config?: unknown) => manager.apply(ctx, config) })
  await fiber
  return { fiber, events, publish }
}

describe('Host generation manager', () => {
  it('replaces the active generation in-process and disposes the previous one', async () => {
    const harness = await startGeneration({ generation: 'gen-one', source: generationSource('gen-one') })
    expect(harness.events).toEqual(['start:gen-one'])

    await harness.publish({ generation: 'gen-two', source: generationSource('gen-two') })
    await waitFor(() => harness.events.includes('start:gen-two'), 'generation swap')

    expect(harness.events).toEqual(['start:gen-one', 'stop:gen-one', 'start:gen-two'])
    await harness.fiber.dispose()
  })

  it('keeps the last known good generation when the candidate fails to start', async () => {
    const harness = await startGeneration({ generation: 'gen-one', source: generationSource('gen-one') })

    await harness.publish({ generation: 'gen-broken', source: failingSource('candidate refused to start') })
    await waitFor(() => harness.events.filter(event => event === 'start:gen-one').length === 2, 'rollback')

    expect(harness.events).toEqual(['start:gen-one', 'stop:gen-one', 'start:gen-one'])
    await harness.fiber.dispose()
  })

  it('refuses a candidate whose Loader contract changed', async () => {
    const harness = await startGeneration({ generation: 'gen-one', source: generationSource('gen-one') })

    await harness.publish({
      generation: 'gen-renamed',
      source: ['export const implementation = {', "  name: 'renamed',", '  apply() {},', '}', ''].join('\n'),
    })
    await settle()

    expect(harness.events).toEqual(['start:gen-one'])
    await harness.fiber.dispose()
  })

  it('refuses a generation published under a different contract version', async () => {
    const harness = await startGeneration({ generation: 'gen-one', source: generationSource('gen-one') })

    await harness.publish({ generation: 'gen-contract', hostContractVersion: 'v2', source: generationSource('gen-contract') })
    await settle()

    expect(harness.events).toEqual(['start:gen-one'])
    await harness.fiber.dispose()
  })

  it('never retries a failed generation until its revision changes', async () => {
    const harness = await startGeneration({ generation: 'gen-one', source: generationSource('gen-one') })
    const failing = failingSource('refused')

    await harness.publish({ generation: 'gen-broken', source: failing })
    await waitFor(() => harness.events.filter(event => event === 'start:gen-one').length === 2, 'first rollback')

    await harness.publish({ generation: 'gen-broken', source: failing })
    await settle()

    expect(harness.events.filter(event => event === 'start:gen-one').length).toBe(2)
    await harness.fiber.dispose()
  })

  it('disposes the active generation with its owning fiber', async () => {
    const harness = await startGeneration({ generation: 'gen-one', source: generationSource('gen-one') })

    await harness.fiber.dispose()

    expect(harness.events).toEqual(['start:gen-one', 'stop:gen-one'])
  })
})
