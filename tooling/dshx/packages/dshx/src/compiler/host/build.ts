import { mkdir, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { build, type InlineConfig, type Plugin } from 'vite'
import { DshxError } from '../../diagnostics.js'
import type { DshCompatibility } from '../../compat/types.js'
import { HOST_GENERATION_DIRECTORY, HOST_GENERATION_MANIFEST } from '../../host/generation-contract.js'
import { CompilerKernel } from '../kernel.js'
import type { BuildArtifact, BuildReport, BuildWatcher, ViteExtensionOptions } from '../types.js'
import { HostCompilerGuards } from './guards.js'

const VIRTUAL_HOST_ENTRY = '\0virtual:dshx-host-entry'
const VIRTUAL_HOST_PUBLIC = '\0virtual:dshx-host-public'
const VIRTUAL_HOST_COMMUNICATION_PUBLIC = '\0virtual:dshx-host-communication-public'
const VIRTUAL_HOST_COMMUNICATION_TYPES_PUBLIC = '\0virtual:dshx-host-communication-types-public'
const VIRTUAL_HOST_PLATFORM_API_PUBLIC = '\0virtual:dshx-host-platform-api-public'
const VIRTUAL_HOST_NATIVE_RPC_PUBLIC = '\0virtual:dshx-host-native-rpc-public'
const VIRTUAL_HOST_SESSION_DIGEST_PUBLIC = '\0virtual:dshx-host-session-digest-public'
const VIRTUAL_HOST_TRACING_PUBLIC = '\0virtual:dshx-host-tracing-public'
const VIRTUAL_HOST_JSON_PUBLIC = '\0virtual:dshx-host-json-public'
const DSHX_HOST_PUBLIC = '@dshfiles/dshx/host'
const DSHX_API_PUBLIC = '@dshfiles/dshx/api'
const DSHX_SETTINGS_PUBLIC = '@dshfiles/dshx/settings'
const DSHX_COMMUNICATION_PUBLIC = '@dshfiles/dshx/communication'
const DSHX_COMMUNICATION_TYPES_PUBLIC = '@dshfiles/dshx/communication/types'
const DSHX_PLATFORM_HOST_API_PUBLIC = '@dshfiles/dshx/platform/host-api'
const DSHX_PLATFORM_NATIVE_RPC_PUBLIC = '@dshfiles/dshx/platform/native-rpc'
const DSHX_PLATFORM_SESSION_DIGEST_PUBLIC = '@dshfiles/dshx/platform/session-digest'
const DSHX_TRACING_PUBLIC = '@dshfiles/dshx/tracing'
const DSHX_JSON_PUBLIC = '@dshfiles/dshx/json'
const HOST_RUNTIME_PATH = fileURLToPath(new URL('../../host/runtime.js', import.meta.url))
const HOST_DEFINE_PATH = fileURLToPath(new URL('../../host/define.js', import.meta.url))
const HOST_PROCESS_PATH = fileURLToPath(new URL('../../host/process.js', import.meta.url))
const HOST_WEB_STARTUP_PATH = fileURLToPath(new URL('../../host/web-startup.js', import.meta.url))
const HOST_OUTSIDE_RELOAD_PATH = fileURLToPath(new URL('../../host/outside-reload.js', import.meta.url))
const HOST_SDK_PATH = fileURLToPath(new URL('../../sdk/host.js', import.meta.url))
const API_DEFINE_PATH = fileURLToPath(new URL('../../api/define.js', import.meta.url))
const API_HOST_CLIENT_PATH = fileURLToPath(new URL('../../api/host-client.js', import.meta.url))
const API_HOST_EVENTS_PATH = fileURLToPath(new URL('../../api/host-events.js', import.meta.url))
const API_COMMON_PATH = fileURLToPath(new URL('../../api/common.js', import.meta.url))
const HOST_PLUGIN_STORAGE_PATH = fileURLToPath(new URL('../../host/plugin-storage.js', import.meta.url))
const HOST_GENERATE_PATH = fileURLToPath(new URL('../../host/generate.js', import.meta.url))
const SETTINGS_DEFINE_PATH = fileURLToPath(new URL('../../settings/define.js', import.meta.url))
const SETTINGS_SECTION_ENTRIES_SCHEMA_PATH = fileURLToPath(new URL('../../settings/section-entries-schema.js', import.meta.url))
const COMMUNICATION_RUNTIME_PATH = fileURLToPath(new URL('../../communication/index.js', import.meta.url))
const COMMUNICATION_TYPES_PATH = fileURLToPath(new URL('../../communication/types.js', import.meta.url))
const PLATFORM_HOST_API_PATH = fileURLToPath(new URL('../../platform/host-api.js', import.meta.url))
const NATIVE_RPC_SCHEMA_PATH = fileURLToPath(new URL('../../platform/native-rpc.js', import.meta.url))
const SESSION_DIGEST_PATH = fileURLToPath(new URL('../../platform/session-digest.js', import.meta.url))
const TRACING_PATH = fileURLToPath(new URL('../../tracing/index.js', import.meta.url))
const JSON_PATH = fileURLToPath(new URL('../../json.js', import.meta.url))
const HOST_GENERATION_PATH = fileURLToPath(new URL('../../host/generation.js', import.meta.url))

/** Opt-in in-process Host replacement: publish immutable generations behind a stable wrapper. */
export interface HostGenerationBuild {
  readonly hostContractVersion: string
}

/** Options for producing one Node ESM Host bundle. */
export interface BuildHostOptions {
  readonly packageId: string
  readonly logicalName?: string
  readonly outDir: string
  readonly entry?: string
  readonly root?: string
  readonly sourcemap?: boolean
  readonly declarations?: boolean
  readonly bundleDependencies?: readonly string[]
  readonly vite?: ViteExtensionOptions
  readonly compatibility?: DshCompatibility
  readonly generation?: HostGenerationBuild
}

export type HostBuildResult = BuildReport

/** Public dshx entry points a Host bundle may import, each inlined through its own virtual module. */
const VIRTUAL_DSHX_PUBLIC_MODULES: ReadonlyMap<string, string> = new Map([
  [DSHX_HOST_PUBLIC, VIRTUAL_HOST_PUBLIC],
  [DSHX_API_PUBLIC, `${VIRTUAL_HOST_PUBLIC}-api`],
  [DSHX_SETTINGS_PUBLIC, `${VIRTUAL_HOST_PUBLIC}-settings`],
  [DSHX_COMMUNICATION_PUBLIC, VIRTUAL_HOST_COMMUNICATION_PUBLIC],
  [DSHX_COMMUNICATION_TYPES_PUBLIC, VIRTUAL_HOST_COMMUNICATION_TYPES_PUBLIC],
  [DSHX_PLATFORM_HOST_API_PUBLIC, VIRTUAL_HOST_PLATFORM_API_PUBLIC],
  [DSHX_PLATFORM_NATIVE_RPC_PUBLIC, VIRTUAL_HOST_NATIVE_RPC_PUBLIC],
  [DSHX_PLATFORM_SESSION_DIGEST_PUBLIC, VIRTUAL_HOST_SESSION_DIGEST_PUBLIC],
  [DSHX_TRACING_PUBLIC, VIRTUAL_HOST_TRACING_PUBLIC],
  [DSHX_JSON_PUBLIC, VIRTUAL_HOST_JSON_PUBLIC],
])

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

function hostEntryPlugin(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildHostOptions): Plugin {
  const name = options.logicalName ?? options.packageId
  const rootFromOutput = relative(paths.outDir, paths.root)
  const rootUrl = isAbsolute(rootFromOutput)
    ? undefined
    : `${(rootFromOutput || '.')
        .split(/[\\/]/)
        .map(segment => encodeURIComponent(segment))
        .join('/')}/`
  return {
    name: 'dshx-host-entry',
    enforce: 'pre',
    resolveId(source) {
      if (source === VIRTUAL_HOST_ENTRY) return VIRTUAL_HOST_ENTRY
      return VIRTUAL_DSHX_PUBLIC_MODULES.get(source) ?? null
    },
    load(id) {
      if (id === VIRTUAL_HOST_PUBLIC) {
        return [
          `import { HostDefinitionModel } from ${JSON.stringify(HOST_DEFINE_PATH)}`,
          'export const defineHost = HostDefinitionModel.define',
          'export const defineCommand = HostDefinitionModel.defineCommand',
          'export const definePromptContext = HostDefinitionModel.definePromptContext',
          'export const definePromptSection = HostDefinitionModel.definePromptSection',
          `export { definePlugin } from ${JSON.stringify(HOST_SDK_PATH)}`,
          // Managed-subprocess helpers are public: a Host plugin that spawns a
          // process needs them to await and terminate it, and without this the
          // only way to reach them is a private import the guard would refuse.
          `export { waitForManagedExit, terminateManagedProcess } from ${JSON.stringify(HOST_PROCESS_PATH)}`,
          `export { readWebStartupOverrides } from ${JSON.stringify(HOST_WEB_STARTUP_PATH)}`,
          `import { ReloadTransactionModel } from ${JSON.stringify(HOST_OUTSIDE_RELOAD_PATH)}`,
          'export const runOutsideReload = ReloadTransactionModel.runOutside',
          'export const scheduleOutsideReload = ReloadTransactionModel.schedule',
          "export { defineTool } from '@deepseek-ai/dsh-tools'",
          `import { HostApiClientModel } from ${JSON.stringify(API_HOST_CLIENT_PATH)}`,
          'export const createHostApiClient = HostApiClientModel.create',
          'export const isApiServed = HostApiClientModel.isServed',
          'export const listApis = HostApiClientModel.list',
          `import { HostApiEventsModel } from ${JSON.stringify(API_HOST_EVENTS_PATH)}`,
          'export const publishApiEvent = HostApiEventsModel.publish',
          `import { PluginStorageModel } from ${JSON.stringify(HOST_PLUGIN_STORAGE_PATH)}`,
          'export const pluginStorage = PluginStorageModel.open',
          // A named function export, not a static class member, so a Host that never calls it drops its dsh-llm import.
          `export { generate } from ${JSON.stringify(HOST_GENERATE_PATH)}`,
          '',
        ].join('\n')
      }
      if (id === `${VIRTUAL_HOST_PUBLIC}-api`) {
        return [
          `import { ApiDefinitionModel } from ${JSON.stringify(API_DEFINE_PATH)}`,
          'export const defineApi = ApiDefinitionModel.define',
          'export const DSHX_REGISTRY_OWNER = ApiDefinitionModel.registryOwner',
          'export const dshxRegistryApi = ApiDefinitionModel.registryApi',
          'export const method = ApiDefinitionModel.method',
          'export const event = ApiDefinitionModel.event',
          `export { isApiError, isApiOwnerMissing, PluginApiError } from ${JSON.stringify(API_COMMON_PATH)}`,
          '',
        ].join('\n')
      }
      if (id === `${VIRTUAL_HOST_PUBLIC}-settings`) {
        return [
          `import { SettingsDefinitionModel } from ${JSON.stringify(SETTINGS_DEFINE_PATH)}`,
          'export const defineSettings = SettingsDefinitionModel.define',
          `export { settingsSearchEntriesSchema, settingsSearchEntrySchema, settingsSectionMetadataSchema } from ${JSON.stringify(SETTINGS_SECTION_ENTRIES_SCHEMA_PATH)}`,
          '',
        ].join('\n')
      }
      if (id === VIRTUAL_HOST_COMMUNICATION_PUBLIC) {
        return `export * from ${JSON.stringify(COMMUNICATION_RUNTIME_PATH)}\n`
      }
      if (id === VIRTUAL_HOST_COMMUNICATION_TYPES_PUBLIC) {
        return `export * from ${JSON.stringify(COMMUNICATION_TYPES_PATH)}\n`
      }
      if (id === VIRTUAL_HOST_PLATFORM_API_PUBLIC) {
        return `export * from ${JSON.stringify(PLATFORM_HOST_API_PATH)}\n`
      }
      if (id === VIRTUAL_HOST_NATIVE_RPC_PUBLIC) {
        return `export * from ${JSON.stringify(NATIVE_RPC_SCHEMA_PATH)}\n`
      }
      if (id === VIRTUAL_HOST_SESSION_DIGEST_PUBLIC) {
        return `export * from ${JSON.stringify(SESSION_DIGEST_PATH)}\n`
      }
      if (id === VIRTUAL_HOST_TRACING_PUBLIC) {
        return `export * from ${JSON.stringify(TRACING_PATH)}\n`
      }
      if (id === VIRTUAL_HOST_JSON_PUBLIC) {
        return `export * from ${JSON.stringify(JSON_PATH)}\n`
      }
      if (id !== VIRTUAL_HOST_ENTRY) return null
      if (paths.entry === undefined) {
        return `export const name = ${JSON.stringify(name)}\nexport const inject = undefined\nexport const Config = undefined\nexport function apply() {}\n`
      }
      const metadata = {
        packageId: options.packageId,
        logicalName: name,
        sourceFile: relative(paths.root, paths.entry).replaceAll('\\', '/'),
        compatibility: options.compatibility,
      }
      const metadataExpression = `{ ...${JSON.stringify(metadata)}${rootUrl === undefined ? '' : `, root: dshxFileURLToPath(new URL(${JSON.stringify(rootUrl)}, import.meta.url))`} }`
      const createModule = [
        `import * as source from ${JSON.stringify(paths.entry)}`,
        `import { createHostModule } from ${JSON.stringify(HOST_RUNTIME_PATH)}`,
        ...(rootUrl === undefined ? [] : [`import { fileURLToPath as dshxFileURLToPath } from 'node:url'`]),
        `const pluginMetadata = ${metadataExpression}`,
        'const plugin = createHostModule(source, pluginMetadata)',
      ]
      if (options.generation !== undefined) {
        return [
          ...createModule,
          `import { createHostGenerationPlugin } from ${JSON.stringify(HOST_GENERATION_PATH)}`,
          'export const implementation = plugin',
          'export const createGenerationManager = options => createHostGenerationPlugin({ ...options, metadata: pluginMetadata, implementation: plugin })',
          'export const name = plugin.name',
          'export const inject = plugin.inject',
          'export const Config = plugin.Config',
          'export function apply(ctx, config) { return plugin.apply(ctx, config) }',
          '',
        ].join('\n')
      }
      return [
        ...createModule,
        'export const name = plugin.name',
        'export const inject = plugin.inject',
        'export const Config = plugin.Config',
        'export function apply(ctx, config) { return plugin.apply(ctx, config) }',
        '',
      ].join('\n')
    },
  }
}

async function resolveOptions(options: BuildHostOptions) {
  if (options.packageId.trim() === '') {
    throw new DshxError('DSHX1001', 'Package id must not be empty.')
  }
  if (options.logicalName !== undefined && options.logicalName.trim() === '') {
    throw new DshxError('DSHX1001', 'Logical Host name must not be empty.')
  }
  const root = await realpath(resolve(options.root ?? process.cwd()))
  const outDir = resolve(root, options.outDir)
  const configuredEntry = options.entry
  const entry =
    configuredEntry === undefined
      ? undefined
      : await realpath(resolve(root, configuredEntry)).catch((cause: unknown) => {
          const file = resolve(root, configuredEntry)
          throw new DshxError('DSHX1301', `Host entry does not exist: ${file}`, { cause, file })
        })
  if (outDir === root || (entry !== undefined && isInside(outDir, entry))) {
    throw new DshxError('DSHX1003', `Host output directory ${outDir} would overwrite project sources.`, {
      hint: 'Choose a dedicated output directory such as dist.',
    })
  }
  return { root, entry, outDir }
}

/**
 * Publish the immutable generation under a stable wrapper.
 *
 * The manifest is written before the wrapper: a running DSH loads the wrapper
 * once, and a process starting inside the write window must never see a
 * manifest older than the generation its wrapper imports.
 */
function hostGenerationPublishPlugin(outDir: string, generation: HostGenerationBuild): Plugin {
  return {
    name: 'dshx-host-generation-publish',
    enforce: 'post',
    async writeBundle(_options, bundle) {
      const chunk = Object.values(bundle).find(item => item.type === 'chunk')
      if (chunk === undefined) {
        throw new DshxError('DSHX1306', 'A Host generation build emitted no entry chunk.')
      }
      const generationId = basename(chunk.fileName).replace(/\.js$/u, '')
      const manifest = { version: 1, generation: generationId, hostContractVersion: generation.hostContractVersion }
      await mkdir(outDir, { recursive: true })
      await writeFileAtomic(resolve(outDir, HOST_GENERATION_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' })
      await writeFileAtomic(resolve(outDir, 'index.js'), hostGenerationWrapperSource(generationId, generation.hostContractVersion), { encoding: 'utf8' })
    },
  }
}

function hostGenerationWrapperSource(generationId: string, hostContractVersion: string): string {
  return [
    `import { implementation, createGenerationManager } from './${HOST_GENERATION_DIRECTORY}/${generationId}.js'`,
    '',
    'export const name = implementation.name',
    'export const inject = implementation.inject',
    'export const Config = implementation.Config',
    '',
    'export function apply(ctx, config) {',
    '  return createGenerationManager({',
    `    generation: ${JSON.stringify(generationId)},`,
    `    hostContractVersion: ${JSON.stringify(hostContractVersion)},`,
    `    manifestUrl: new URL('./${HOST_GENERATION_MANIFEST}', import.meta.url),`,
    '  }).apply(ctx, config)',
    '}',
    '',
  ].join('\n')
}

function hostGenerationReport(report: BuildReport, declarations: boolean): BuildReport {
  const output: BuildArtifact[] = [
    { fileName: 'index.js', type: 'chunk' },
    { fileName: HOST_GENERATION_MANIFEST, type: 'asset' },
    ...report.output.filter(item => item.type !== 'declaration').map(item => ({ ...item, fileName: `${HOST_GENERATION_DIRECTORY}/${item.fileName}` })),
  ]
  if (declarations) output.push({ fileName: 'index.d.ts', type: 'declaration' })
  return { ...report, output }
}

async function hostConfig(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildHostOptions, watch: boolean): Promise<InlineConfig> {
  const bundleDependencies = options.bundleDependencies ?? []
  if (bundleDependencies.includes('@deepseek-ai/cordis')) {
    throw new DshxError('DSHX4004', 'Host bundleDependencies cannot include @deepseek-ai/cordis.', {
      hint: 'Keep the Host Cordis identity external.',
    })
  }
  const external = (source: string): boolean => {
    if (VIRTUAL_DSHX_PUBLIC_MODULES.has(source)) return false
    const bundled = bundleDependencies.some(dependency => source === dependency || source.startsWith(`${dependency}/`))
    return !bundled && HostCompilerGuards.isHostExternal(source)
  }
  const assetsInlineLimit = (): boolean => true
  const generation = options.generation
  const generationOutDir = generation === undefined ? paths.outDir : resolve(paths.outDir, HOST_GENERATION_DIRECTORY)
  const output = {
    format: 'es',
    entryFileNames: generation === undefined ? 'index.js' : '[hash].js',
    codeSplitting: false,
    exports: 'named',
  } as const
  const userPlugins = await CompilerKernel.resolveUserPlugins(options.vite?.plugins, watch)
  return {
    root: paths.root,
    configFile: false,
    publicDir: false,
    appType: 'custom',
    mode: watch ? 'development' : 'production',
    logLevel: 'error',
    plugins: [
      hostEntryPlugin(paths, options),
      ...userPlugins,
      CompilerKernel.artifactDeclarationPlugin('host', paths.outDir, options.declarations ?? true),
      // A generation build publishes a hashed chunk behind a wrapper, so only the primary Host
      // bundle names its own entry and can carry a dependency manifest a planner can read.
      ...(generation === undefined
        ? [CompilerKernel.dependencyManifestPlugin({ face: 'host', root: paths.root, outDir: paths.outDir, entryFile: 'index.js' })]
        : []),
      HostCompilerGuards.hostPeerDependencyPlugin(paths.root),
      CompilerKernel.boundaryPlugin({
        face: 'host',
        root: paths.root,
        input: VIRTUAL_HOST_ENTRY,
        target: 'es2024',
        assetsInlineLimit,
        external,
        output,
      }),
      HostCompilerGuards.singleHostChunkPlugin(generation === undefined ? 'index.js' : () => true),
      ...(generation === undefined ? [] : [hostGenerationPublishPlugin(paths.outDir, generation)]),
    ],
    ssr: { noExternal: [...bundleDependencies] },
    build: {
      // A Host artifact runs inside the DSH Node process, so the build must
      // run the server environment: without a server consumer Vite treats
      // `node:*` imports as browser externals and rewrote every bare
      // `process.env.X` read in plugin source to an empty-object lookup.
      ssr: true,
      target: 'es2024',
      outDir: generationOutDir,
      emptyOutDir: false,
      copyPublicDir: false,
      assetsInlineLimit,
      minify: false,
      sourcemap: options.sourcemap ?? true,
      watch: null,
      rollupOptions: {
        input: VIRTUAL_HOST_ENTRY,
        preserveEntrySignatures: 'strict',
        external,
        // Keep side effects in project files but drop side-effect imports of
        // Node packages: a stdlib-only Host artifact stays importable on bare
        // Node even when the surrounding DSH install is not available.
        treeshake: { moduleSideEffects: 'no-external' },
        output,
      },
    },
  }
}

/** Start a Host watcher without awaiting a successful initial build. */
export async function watchHost(options: BuildHostOptions): Promise<BuildWatcher> {
  const paths = await resolveOptions(options)
  const config = await hostConfig(paths, options, true)
  return CompilerKernel.buildWatcher(
    await build({
      ...config,
      build: { ...config.build, watch: {} },
    }),
    'host',
    'DSHX1305',
  )
}

/** Build a DSH-compatible Host entry as one Node ESM file. */
export async function buildHost(options: BuildHostOptions): Promise<HostBuildResult> {
  const paths = await resolveOptions(options)
  const config = await hostConfig(paths, options, false)
  const declarations = options.declarations ?? true
  const report = CompilerKernel.buildReport(
    await build(config).catch(CompilerKernel.surfaceGuardError),
    'host',
    'index.js',
    paths.outDir,
    declarations,
    'DSHX1304',
  )
  return options.generation === undefined ? report : hostGenerationReport(report, declarations)
}
