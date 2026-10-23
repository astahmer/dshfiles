import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
import { buildHost } from '../src/compiler/index.js'
import { watchHost } from '../src/compiler/host/build.js'
import { writePluginFixture } from './plugin-fixture.js'

const temporaryDirectories: string[] = []

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'dshx-host-'))
  temporaryDirectories.push(directory)
  await writePluginFixture(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('host compiler', () => {
  it('bundles every runtime export of @dshfiles/dshx/host', async () => {
    const publicExports = Object.keys(await import('../src/host/index.js'))
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        `import { ${publicExports.join(', ')} } from '@dshfiles/dshx/host'`,
        `export default defineHost({ setup(ctx) { ctx.exports = [${publicExports.join(', ')}] } })`,
        '',
      ].join('\n'),
    )
    await expect(
      buildHost({ packageId: '@dshx/fixture-plugin', logicalName: 'logical-fixture', root, entry: 'src/host.ts', outDir: 'dist' }),
    ).resolves.toBeDefined()
  })

  it('adapts a defineHost default export and inlines the DSHX Host runtime', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost } from '@dshfiles/dshx/host'",
        "const first = { name: 'first' }",
        "const second = { name: 'second' }",
        'export default defineHost({',
        "  inject: ['agents', 'agents'],",
        '  tools: [first, second],',
        "  setup(ctx) { ctx.calls.push('setup') },",
        '})',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      logicalName: 'logical-fixture',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })

    const output = resolve(root, 'dist/index.js')
    const code = await readFile(output, 'utf8')
    expect(code).not.toMatch(/from ['"]dshx\/(?:host|internal-host-runtime)['"]/)
    expect(code).not.toContain(JSON.stringify(root))
    expect(code).toContain('src/host.ts')
    const plugin = (await import(`${pathToFileURL(output).href}?test=${Date.now()}`)) as {
      name: string
      inject: readonly string[]
      apply(ctx: unknown): unknown
    }
    const calls: string[] = []
    const ctx = {
      calls,
      tools: {
        register(value: { name: string }) {
          calls.push(`tool:${value.name}`)
        },
      },
    }
    expect(plugin.name).toBe('logical-fixture')
    expect(plugin.inject).toEqual(['agents', 'tools'])
    plugin.apply(ctx)
    expect(calls).toEqual(['tool:first', 'tool:second', 'setup'])
  })

  it('keeps official defineTool external while adapting the Host entry', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost, defineTool } from '@dshfiles/dshx/host'",
        'const tool = defineTool({',
        "  name: 'status',",
        "  description: 'Return status.',",
        '  parameters: {},',
        '  output: {',
        "    schema: { type: 'string' },",
        "    render: (_args, value) => [{ type: 'text', text: value }],",
        '  },',
        "  async execute() { return 'ok' },",
        '})',
        'export default defineHost({ tools: [tool] })',
        '',
      ].join('\n'),
    )

    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })

    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    expect(code).not.toMatch(/from ['"](?:dshx\/host|dshx\/internal-host-runtime)['"]/)
    expect(code).toMatch(/from ['"]@deepseek-ai\/dsh-tools['"]/)
    expect(code.match(/from ['"]@deepseek-ai\/dsh-tools['"]/g)).toHaveLength(1)
    const plugin = (await import(`${pathToFileURL(resolve(root, 'dist/index.js')).href}?test=${Date.now()}`)) as {
      inject: readonly string[]
      apply(ctx: unknown): unknown
    }
    const registered: unknown[] = []
    plugin.apply({
      tools: {
        register(tool: unknown) {
          registered.push(tool)
        },
      },
    })
    expect(plugin.inject).toEqual(['tools'])
    expect(registered).toHaveLength(1)
  })

  it('preserves a Standard Schema Loader Config beside Host API contributions', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost } from '@dshfiles/dshx/host'",
        "import { z } from 'zod'",
        "import { defineApi, method } from '@dshfiles/dshx/api'",
        'const Config = z.object({ servers: z.array(z.string()).default([]) })',
        "const api = defineApi({ id: 'manager', version: 1, methods: { list: method() } })",
        'export default defineHost({ Config, apis: [api.host({ list() { return [] } })] })',
        '',
      ].join('\n'),
    )

    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })

    const output = resolve(root, 'dist/index.js')
    const plugin = (await import(`${pathToFileURL(output).href}?test=${Date.now()}`)) as {
      Config: { '~standard'?: { version?: number; vendor?: string } }
      inject: readonly string[]
      apply(ctx: unknown, config?: unknown): unknown
    }
    expect(plugin.Config['~standard']).toMatchObject({ version: 1, vendor: 'zod' })
    expect(plugin.inject).toContain('connection')
  })

  it('embeds the same API contract validation as the public source module', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineApi, method } from '@dshfiles/dshx/api'",
        "import { defineHost } from '@dshfiles/dshx/host'",
        "const invalid = defineApi({ id: 'invalid/id', version: 1, methods: { get: method() } })",
        'export default defineHost({ api: invalid.host({ get() {} }) })',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    const output = resolve(root, 'dist/index.js')
    await expect(import(`${pathToFileURL(output).href}?test=${Date.now()}`)).rejects.toThrow('Invalid API id')
    expect(await readFile(output, 'utf8')).not.toContain('@dshfiles/dshx/api')
  })

  it('lets a Host handler throw PluginApiError from the public API module', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineApi, method, PluginApiError } from '@dshfiles/dshx/api'",
        "import { defineHost } from '@dshfiles/dshx/host'",
        "const api = defineApi({ id: 'failing', version: 1, methods: { get: method() } })",
        "export default defineHost({ apis: [api.host({ get() { throw new PluginApiError('Refresh and try again.', { code: 'stale' }) } })] })",
        '',
      ].join('\n'),
    )
    await buildHost({ packageId: '@dshx/fixture-plugin', root, entry: 'src/host.ts', outDir: 'dist' })
    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    expect(code).toContain('dshx.plugin-api-error')
    expect(code).not.toMatch(/from\s+['"]@dshfiles\/dshx\//)
  })

  it('inlines loopbackLaunchUrl from the Host API boundary', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost } from '@dshfiles/dshx/host'",
        "import { loopbackLaunchUrl } from '@dshfiles/dshx/platform/host-api'",
        'export default defineHost({ setup() { return { loopbackLaunchUrl } } })',
        '',
      ].join('\n'),
    )
    await buildHost({ packageId: '@dshx/fixture-plugin', root, entry: 'src/host.ts', outDir: 'dist' })
    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    expect(code).toContain('loopbackLaunchUrl')
    expect(code).not.toMatch(/from\s+['"]@dshfiles\/dshx\//)
  })

  it('inlines the public Host platform API helpers into Host artifacts', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost } from '@dshfiles/dshx/host'",
        "import { createDshxApiCaller, loopbackLaunchUrl } from '@dshfiles/dshx/platform/host-api'",
        "import { nativeRpcRequestSchema } from '@dshfiles/dshx/platform/native-rpc'",
        "import { digestSession } from '@dshfiles/dshx/platform/session-digest'",
        "import { withSpan } from '@dshfiles/dshx/tracing'",
        'export default defineHost({ setup() { return { createDshxApiCaller, loopbackLaunchUrl, nativeRpcRequestSchema, digestSession, withSpan } } })',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    expect(code).toContain('createDshxApiCaller')
    expect(code).toContain('loopbackLaunchUrl')
    expect(code).toContain('nativeRpcRequestSchema')
    expect(code).toContain('digestSession')
    expect(code).toContain('@dshfiles/dshx.tracing.v1')
    expect(code).not.toMatch(/from\s+['"]@dshfiles\/dshx\//)
  })

  it('inlines defineCommand and registers official definitions through ctx.commands', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineCommand, defineHost } from '@dshfiles/dshx/host'",
        "const status = defineCommand({ name: 'status', description: 'Return status.', handler: () => ({ kind: 'success', text: 'ready' }) })",
        'export default defineHost({ commands: [status] })',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    const output = resolve(root, 'dist/index.js')
    const code = await readFile(output, 'utf8')
    expect(code).not.toContain('@dshfiles/dshx/host')
    expect(code).not.toContain('@deepseek-ai/dsh-commands')
    const plugin = (await import(`${pathToFileURL(output).href}?test=${Date.now()}`)) as { inject: string[]; apply(ctx: unknown): void }
    const registered: unknown[] = []
    plugin.apply({
      commands: {
        register(command: unknown) {
          registered.push(command)
          return () => undefined
        },
      },
    })
    expect(plugin.inject).toEqual(['commands'])
    expect(registered).toHaveLength(1)
  })

  it('uses the public Prompt helpers in built artifacts without retaining DSHX or Prompt package imports', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost, definePromptContext, definePromptSection } from '@dshfiles/dshx/host'",
        "const guidanceValue = { name: 'plugin:guidance', order: 150, text: 'Use status.' }",
        "const contextValue = { name: 'plugin:runtime', order: 0, text: () => 'ready' }",
        'const guidance = definePromptSection(guidanceValue)',
        'const runtime = definePromptContext(contextValue)',
        'export default defineHost({ prompts: [guidance, runtime] })',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    const output = resolve(root, 'dist/index.js')
    const code = await readFile(output, 'utf8')
    expect(code).not.toContain('@dshfiles/dshx/host')
    expect(code).not.toContain('@deepseek-ai/dsh-system-prompt')
    const plugin = (await import(`${pathToFileURL(output).href}?test=${Date.now()}`)) as { inject: string[]; apply(ctx: unknown): void }
    const registered: Array<{ kind: string; value: unknown }> = []
    plugin.apply({
      systemPrompt: {
        section(value: unknown) {
          registered.push({ kind: 'section', value })
          return () => undefined
        },
        context(value: unknown) {
          registered.push({ kind: 'context', value })
          return () => undefined
        },
      },
    })
    expect(plugin.inject).toEqual(['systemPrompt'])
    expect(registered).toEqual([
      {
        kind: 'section',
        value: expect.objectContaining({ name: 'plugin:guidance', order: 150 }),
      },
      {
        kind: 'context',
        value: expect.objectContaining({ name: 'plugin:runtime', order: 0 }),
      },
    ])
  })

  it('inlines the shared Settings helper while keeping only the official Host service import', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost } from '@dshfiles/dshx/host'",
        "import { defineSettings } from '@dshfiles/dshx/settings'",
        "const schema = Object.assign(value => value, { toJSON: () => ({ type: 'object' }) })",
        "const runtimeSettings = defineSettings({ namespace: 'fixture', schema, applies: 'live' })",
        'export default defineHost({ settings: [runtimeSettings] })',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    expect(code).not.toContain('@dshfiles/dshx/settings')
    expect(code).not.toContain('@dshfiles/dshx/host')
    expect(code).not.toContain('@deepseek-ai/dsh-settings')
    expect(code).toContain('settings: [defineSettings({')
    expect(code).toContain('namespace: "fixture"')
  })

  it('emits a Node ESM entry with a sourcemap and preserves package imports', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { join } from 'node:path'",
        "import helper from './host-helper.ts'",
        'export const name = helper',
        "export const inject = ['tools']",
        'export function apply(ctx: { tools: { register(tool: unknown): unknown } }) {',
        '  ctx.tools.register({ name: join(name, helper) })',
        '}',
        '',
      ].join('\n'),
    )
    await writeFile(resolve(root, 'src/host-helper.ts'), "export default 'dshx-host'\n")

    const report = await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })

    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    const map = JSON.parse(await readFile(resolve(root, 'dist/index.js.map'), 'utf8')) as {
      sources: string[]
      sourcesContent?: Array<string | null>
    }
    expect(code).toMatch(/from ['"]node:path['"]/)
    expect(code).toContain('dshx-host')
    expect(code).toMatch(/sourceMappingURL=index\.js\.map/)
    expect(map.sources.some(source => source.endsWith('/src/host.ts') || source.endsWith('src/host.ts'))).toBe(true)
    expect(map.sourcesContent?.some(source => source?.includes('export const name') === true)).toBe(true)
    expect(report).toMatchObject({ face: 'host', entryFile: 'index.js' })
    expect(report.output).toEqual(expect.arrayContaining([{ fileName: 'index.d.ts', type: 'declaration' }]))
    expect(await readFile(resolve(root, 'dist/index.d.ts'), 'utf8')).toContain('export declare function apply(ctx: Context')
  })

  it('bundles selected Host package roots and leaves other packages external', async () => {
    const root = await temporaryProject()
    const selectedPackage = resolve(root, 'node_modules/@test/local-core')
    await mkdir(selectedPackage, { recursive: true })
    await writeFile(resolve(selectedPackage, 'package.json'), JSON.stringify({ name: '@test/local-core', type: 'module' }))
    await writeFile(resolve(selectedPackage, 'index.js'), "export const rootValue = 'local-core-root'\n")
    await writeFile(resolve(selectedPackage, 'nested.js'), "export const nestedValue = 'local-core-nested'\n")
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { rootValue } from '@test/local-core'",
        "import { nestedValue } from '@test/local-core/nested.js'",
        "import { externalValue } from '@test/local-core-extra'",
        "import { sharedValue } from '@test/shared-host-package'",
        'export const name = `${rootValue}:${nestedValue}:${externalValue}:${sharedValue}`',
        'export const inject = []',
        'export function apply() {}',
        '',
      ].join('\n'),
    )

    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
      bundleDependencies: ['@test/local-core'],
    })

    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    expect(code).toContain('local-core-root')
    expect(code).toContain('local-core-nested')
    expect(code).not.toMatch(/from ['"]@test\/local-core(?:\/|['"])/)
    expect(code).toContain('@test/local-core-extra')
    expect(code).toContain('@test/shared-host-package')
  })

  it('requires external DSH Host imports to be peer dependencies', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { createScope } from '@deepseek-ai/dsh-scope'",
        'export const scopeFactory = createScope',
        "export const loadLlm = () => import('@deepseek-ai/dsh-llm')",
        'export const inject = []',
        'export function apply() {}',
        '',
      ].join('\n'),
    )
    const options = {
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    }

    await expect(buildHost(options)).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          name: 'DshxError',
          pluginCode: 'DSHX4005',
          message: expect.stringContaining('@deepseek-ai/dsh-llm, @deepseek-ai/dsh-scope'),
        }),
      ]),
    })

    const packageFile = resolve(root, 'package.json')
    const manifest: unknown = JSON.parse(await readFile(packageFile, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest) || !('peerDependencies' in manifest)) {
      throw new TypeError('Host fixture package.json has no peerDependencies object.')
    }
    const peerDependencies = manifest.peerDependencies
    if (typeof peerDependencies !== 'object' || peerDependencies === null || Array.isArray(peerDependencies)) {
      throw new TypeError('Host fixture peerDependencies must be an object.')
    }
    const updatedManifest = {
      ...manifest,
      peerDependencies: {
        ...peerDependencies,
        '@deepseek-ai/dsh-scope': '>=0.2.0-rc.1 <0.3.0-0',
        '@deepseek-ai/dsh-llm': '>=0.2.0-rc.1 <0.3.0-0',
      },
    }
    await writeFile(packageFile, JSON.stringify(updatedManifest, null, 2) + '\n')

    await buildHost(options)
    const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    expect(code).toContain('@deepseek-ai/dsh-scope')
    expect(code).toContain('@deepseek-ai/dsh-llm')
  })

  it('keeps Cordis external when called through the programmatic Host API', async () => {
    const root = await temporaryProject()

    await expect(
      buildHost({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/host.ts',
        outDir: 'dist',
        bundleDependencies: ['@deepseek-ai/cordis'],
      }),
    ).rejects.toMatchObject({ code: 'DSHX4004' })
  })

  it('builds a client-only project with the standard no-op Host entry', async () => {
    const root = await temporaryProject()
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      logicalName: 'client-only-host',
      root,
      outDir: 'dist',
    })
    const output = resolve(root, 'dist/index.js')
    expect(await readFile(output, 'utf8')).toContain('function apply()')
    const plugin = (await import(`${pathToFileURL(output).href}?test=${Date.now()}`)) as { name: string; apply(): unknown }
    expect(plugin.name).toBe('client-only-host')
    expect(plugin.apply()).toBeUndefined()
  })

  it('preserves native Host Config and forwards apply arguments', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "export const name = 'native-host'",
        "export const inject = { agents: { mode: 'test' } }",
        "export const Config = { marker: 'schema' }",
        'export function apply(ctx, config) { ctx.received = config; return config.enabled }',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      logicalName: 'fallback-name',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    const output = resolve(root, 'dist/index.js')
    const plugin = (await import(`${pathToFileURL(output).href}?test=${Date.now()}`)) as {
      name: string
      inject: unknown
      Config: unknown
      apply(ctx: { received?: unknown }, config: unknown): unknown
    }
    const ctx: { received?: unknown } = {}
    const config = { enabled: true }
    expect(plugin.name).toBe('native-host')
    expect(plugin.inject).toEqual({ agents: { mode: 'test' } })
    expect(plugin.Config).toEqual({ marker: 'schema' })
    expect(plugin.apply(ctx, config)).toBe(true)
    expect(ctx.received).toBe(config)
  })

  it('runs Host transforms but rejects protected kernel overrides', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/host.ts'), "export const name = 'host-before'\nexport function apply() {}\n")
    const transform: Plugin = {
      name: 'host-transform',
      transform(code, id) {
        return id.endsWith('/src/host.ts') ? code.replace('host-before', 'host-after') : null
      },
    }
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
      vite: { plugins: [transform] },
    })
    expect(await readFile(resolve(root, 'dist/index.js'), 'utf8')).toContain('host-after')

    const override: Plugin = {
      name: 'host-output-override',
      config: () => ({
        build: { rollupOptions: { output: { format: 'cjs' } } },
      }),
    }
    await expect(
      buildHost({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/host.ts',
        outDir: 'dist',
        vite: { plugins: [override] },
      }),
    ).rejects.toThrow('DSHX1403')

    const corrupt: Plugin = {
      name: 'corrupt-host-protocol',
      renderChunk: () => 'export const broken = true',
    }
    await expect(
      buildHost({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/host.ts',
        outDir: 'dist',
        vite: { plugins: [corrupt] },
      }),
    ).rejects.toThrow('DSHX1302')
  })

  it('can omit generated artifact declarations explicitly', async () => {
    const root = await temporaryProject()
    const report = await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
      declarations: false,
    })
    expect(report.output.some(item => item.type === 'declaration')).toBe(false)
    await expect(readFile(resolve(root, 'dist/index.d.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not remove an existing Client artifact in the shared output directory', async () => {
    const root = await temporaryProject()
    await mkdir(resolve(root, 'dist'), { recursive: true })
    await writeFile(resolve(root, 'dist/client.js'), 'window.__ModuleLoader__\n')
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    expect(await readFile(resolve(root, 'dist/client.js'), 'utf8')).toBe('window.__ModuleLoader__\n')
  })

  it('rewrites the Host artifact after a watched source change', async () => {
    const root = await temporaryProject()
    const sourcePath = resolve(root, 'src/host.ts')
    await writeFile(
      sourcePath,
      "import { defineHost } from '@dshfiles/dshx/host'\nexport default defineHost({ setup() { return 'Fixture has no Host behavior' } })\n",
    )
    const result = await watchHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    if (!('on' in result) || !('close' in result)) throw new Error('watch build did not return a watcher')
    const events: string[] = []
    result.on('event', event => {
      events.push(event.code)
    })

    const waitForEvent = async (code: string): Promise<void> => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (events.includes(code)) return
        await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
      }
      throw new Error(`timed out waiting for watcher event ${code}; events: ${events.join(', ')}`)
    }

    const waitForArtifact = async (predicate: (code: string) => boolean): Promise<string> => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        try {
          const code = await readFile(resolve(root, 'dist/index.js'), 'utf8')
          if (predicate(code)) return code
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
      }
      throw new Error(`timed out waiting for watched Host artifact; events: ${events.join(', ')}`)
    }

    try {
      // Wait until the watcher's own initial build is idle. Writing while that build is
      // running can be coalesced into it on fast filesystems and never trigger a rebuild.
      await waitForEvent('END')
      const first = await waitForArtifact(code => code.includes('Fixture has no Host behavior'))
      events.length = 0
      const source = await readFile(sourcePath, 'utf8')
      await writeFile(sourcePath, source.replace('Fixture has no Host behavior', 'Fixture Host rebuilt'))
      await waitForEvent('END')
      const second = await waitForArtifact(code => code.includes('Fixture Host rebuilt'))
      expect(first).not.toBe(second)
    } finally {
      await result.close()
    }
  })

  it('keeps watching after the initial build fails and recovers after a source fix', async () => {
    const root = await temporaryProject()
    const sourcePath = resolve(root, 'src/host.ts')
    await writeFile(sourcePath, 'export const = broken\n')
    const watcher = await watchHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
    })
    const waitFor = (code: 'ERROR' | 'BUNDLE_END'): Promise<void> =>
      new Promise((resolveEvent, reject) => {
        const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${code}`)), 10_000)
        watcher.on('event', event => {
          if (event.code !== code) return
          clearTimeout(timeout)
          resolveEvent()
        })
      })

    try {
      await waitFor('ERROR')
      const recovered = waitFor('BUNDLE_END')
      await writeFile(sourcePath, "export const marker = 'watcher recovered'\nexport function apply() {}\n")
      await recovered
      expect(await readFile(resolve(root, 'dist/index.js'), 'utf8')).toContain('watcher recovered')
    } finally {
      await watcher.close()
    }
  })

  it('publishes an immutable generation behind a stable wrapper and manifest', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost, defineTool } from '@dshfiles/dshx/host'",
        'const status = defineTool({',
        "  name: 'generation_status',",
        "  description: 'Return generation status.',",
        '  parameters: {},',
        "  output: { schema: { type: 'string' }, render: () => [] },",
        "  async execute() { return 'ok' },",
        '})',
        'export default defineHost({',
        "  name: 'generation-host',",
        '  tools: [status],',
        '})',
        '',
      ].join('\n'),
    )

    const report = await buildHost({
      packageId: '@dshx/fixture-plugin',
      logicalName: 'logical-fixture',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
      generation: { hostContractVersion: 'v1' },
    })

    const wrapper = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    const imported = /from '\.\/\.dshx-host-generations\/([A-Za-z0-9_-]+)\.js'/.exec(wrapper)
    expect(imported).not.toBeNull()
    const generation = imported![1]!
    expect(wrapper).toContain('createGenerationManager')
    expect(wrapper).toContain(`generation: ${JSON.stringify(generation)}`)

    const manifest = JSON.parse(await readFile(resolve(root, 'dist/.dshx-host-manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toEqual({ version: 1, generation, hostContractVersion: 'v1' })

    const generationCode = await readFile(resolve(root, 'dist/.dshx-host-generations', `${generation}.js`), 'utf8')
    expect(generationCode).toContain('export {')
    expect(generationCode).toContain('implementation')
    expect(generationCode).not.toMatch(/from ['"]@dshfiles\/dshx\//)

    expect(report.output.map(item => item.fileName)).toEqual(
      expect.arrayContaining(['index.js', '.dshx-host-manifest.json', `.dshx-host-generations/${generation}.js`, 'index.d.ts']),
    )
  })

  it('reuses the generation file name when the source is unchanged', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/host.ts'), "import { defineHost } from '@dshfiles/dshx/host'\nexport default defineHost({ name: 'stable-host' })\n")
    const options = {
      packageId: '@dshx/fixture-plugin',
      logicalName: 'logical-fixture',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
      generation: { hostContractVersion: 'v1' },
    } as const

    await buildHost(options)
    const first = await readFile(resolve(root, 'dist/index.js'), 'utf8')
    await buildHost(options)
    const second = await readFile(resolve(root, 'dist/index.js'), 'utf8')

    expect(second).toBe(first)
  })

  it('loads the published wrapper through a real Cordis context', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/host.ts'),
      [
        "import { defineHost, defineTool } from '@dshfiles/dshx/host'",
        'const status = defineTool({',
        "  name: 'generation_status',",
        "  description: 'Return generation status.',",
        '  parameters: {},',
        "  output: { schema: { type: 'string' }, render: () => [] },",
        "  async execute() { return 'ok' },",
        '})',
        'export default defineHost({',
        "  name: 'generation-host',",
        '  tools: [status],',
        '})',
        '',
      ].join('\n'),
    )
    await buildHost({
      packageId: '@dshx/fixture-plugin',
      logicalName: 'logical-fixture',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
      generation: { hostContractVersion: 'v1' },
    })

    const output = resolve(root, 'dist/index.js')
    const module = (await import(`${pathToFileURL(output).href}?generation=${Date.now()}`)) as {
      name: string
      apply(ctx: Context, config?: unknown): unknown
    }
    const registered: string[] = []
    const context = new Context()
    context.provide('tools', {
      register(value: { name: string }) {
        registered.push(value.name)
      },
    })

    expect(module.name).toBe('generation-host')
    const fiber = context.plugin(module)
    await fiber
    expect(registered).toEqual(['generation_status'])
    await fiber.dispose()
  })
})
