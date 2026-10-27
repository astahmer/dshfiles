import { readdir, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type InlineConfig, type Plugin } from 'vite'
import { parse } from 'yaml'
import { DEFAULT_COMPATIBILITY } from '../../compat/index.js'
import type { DshCompatibility } from '../../compat/types.js'
import { DshxError } from '../../diagnostics.js'
import { CompilerKernel } from '../kernel.js'
import type { BuildReport, BuildWatcher, ViteExtensionOptions } from '../types.js'
import { clientCssPlugin } from './css.js'
import { SharedRuntime } from './shared-runtime.js'
import { CLIENT_SDK_PROVIDERS, CLIENT_SETUP_SERVICE_CAPABILITIES, ClientCapabilityAnalysis } from './capabilities.js'
import { installedLocaleNamespaces } from './installed.js'
import { LocaleNamespaceOwnershipModel } from './locale-ownership.js'
import { profilePackages } from './profile-scan.js'
import { clientGuardPlugin, singleClientChunkPlugin } from './guards.js'
import { clientSlotRegistrations, slotOccupancyConflicts } from './slot-occupancy.js'

const VIRTUAL_CLIENT_ENTRY = '\0virtual:dshx-client-entry'
const VIRTUAL_CLIENT_PUBLIC = '\0virtual:dshx-client-public'
const VIRTUAL_CLIENT_API_HOOKS = '\0virtual:dshx-client-api-hooks'
const VIRTUAL_CLIENT_SETTINGS_HOOK = '\0virtual:dshx-client-settings-hook'
const DSHX_CLIENT_PUBLIC = '@dshfiles/dshx/client'
const DSHX_API_PUBLIC = '@dshfiles/dshx/api'
const DSHX_SETTINGS_PUBLIC = '@dshfiles/dshx/settings'
const DSHX_CONVERSATION_PUBLIC = '@dshfiles/dshx/experimental/conversation'
const SETTINGS_PROVIDER_PACKAGE = '@deepseek-ai/dsh-client-ui-settings'
const SETTINGS_CAPABILITY_GLOBAL = '__DSHX_CLIENT_SETTINGS_CAPABILITY__'
const API_PROVIDER_PACKAGE = '@deepseek-ai/dsh-client-connection'
const API_CAPABILITY_GLOBAL = '__DSHX_CLIENT_API_CAPABILITY__'
const CONVERSATION_PROVIDER_PACKAGES = ['@deepseek-ai/dsh-client-ui-conversation'] as const
const LOCALE_PROVIDER_PACKAGE = '@deepseek-ai/dsh-client-locale'
const CLIENT_RUNTIME_PATH = fileURLToPath(new URL('../../client/runtime.js', import.meta.url))
const CLIENT_DEFINE_PATH = fileURLToPath(new URL('../../client/define.js', import.meta.url))
const CLIENT_SDK_PATH = fileURLToPath(new URL('../../sdk/client.js', import.meta.url))
const CLIENT_LOCALE_PATH = fileURLToPath(new URL('../../client/locale.js', import.meta.url))
const CLIENT_HOST_COMMANDS_PATH = fileURLToPath(new URL('../../client/host-commands.js', import.meta.url))
const CLIENT_API_PATH = fileURLToPath(new URL('../../api/client.js', import.meta.url))
const CLIENT_BROKER_PATH = fileURLToPath(new URL('../../client/broker.js', import.meta.url))
const CLIENT_APP_SERVICES_PATH = fileURLToPath(new URL('../../client/app-services.js', import.meta.url))
const CLIENT_REGISTRIES_PATH = fileURLToPath(new URL('../../client/registries.js', import.meta.url))
const CLIENT_STORE_PATH = fileURLToPath(new URL('../../client/store.js', import.meta.url))
const CLIENT_HOOKS_PATH = fileURLToPath(new URL('../../client/hooks.js', import.meta.url))
const CLIENT_PLUGIN_CONTEXT_PATH = fileURLToPath(new URL('../../client/plugin-context.js', import.meta.url))
const API_DEFINE_PATH = fileURLToPath(new URL('../../api/define.js', import.meta.url))
const API_RUNTIME_PATH = fileURLToPath(new URL('../../api/runtime.js', import.meta.url))
const API_COMMON_PATH = fileURLToPath(new URL('../../api/common.js', import.meta.url))
const SETTINGS_DEFINE_PATH = fileURLToPath(new URL('../../settings/define.js', import.meta.url))
const SETTINGS_CLIENT_PATH = fileURLToPath(new URL('../../settings/client.js', import.meta.url))
const SETTINGS_PAGE_RENDERER_PATH = fileURLToPath(new URL('../../settings/page-renderer.js', import.meta.url))
const CONVERSATION_DEFINE_PATH = fileURLToPath(new URL('../../conversation/define.js', import.meta.url))

/** Options for producing one DSH-compatible lazy-CJS client bundle. */
export interface BuildClientOptions {
  readonly packageId: string
  readonly logicalName?: string
  readonly entry: string
  readonly outDir: string
  readonly root?: string
  readonly sourcemap?: boolean
  readonly minify?: boolean
  readonly declarations?: boolean
  readonly vite?: ViteExtensionOptions
  readonly bundleDependencies?: readonly string[]
  readonly external?: readonly string[]
  /** Package id of the shared-runtime supplier whose modules replace private copies. */
  readonly shared?: string
  /** Exact module specifiers this package supplies as a shared runtime. */
  readonly sharedRuntime?: readonly string[]
  /** Package edges declared by dsh.client.inject. */
  readonly inject?: readonly string[]
  /**
   * DSH profile whose installed plugin set scopes sibling locale-namespace
   * conflicts. Omitted means shipped namespaces are still refused, but a plugin
   * installed alongside this one cannot be detected.
   */
  readonly localeOwnershipProfile?: string
  readonly compatibility?: DshCompatibility
}

export type ClientBuildResult = BuildReport

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

const PLUGIN_PAGE_SLOT = 'plugins.bundle.config'

/**
 * Loader row ids this package inserts for itself. DSHX requires a Settings
 * namespace to equal its row id, so these are the namespaces the package's
 * Plugins page can render; the runtime shows only the ones the Host serves.
 * A client that registers its own bundle page keeps it.
 */
async function pluginPageNamespaces(root: string, entry: string, packageId: string): Promise<readonly string[]> {
  let patch: unknown
  try {
    patch = parse(await readFile(resolve(root, 'cordis.patch.yml'), 'utf8'))
  } catch {
    return []
  }
  const ids = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const row = value as Record<string, unknown>
    if (typeof row.id === 'string' && typeof row.name === 'string' && (row.name === packageId || row.name.startsWith(`${packageId}/`))) ids.add(row.id)
    Object.values(row).forEach(visit)
  }
  visit(patch)
  if (ids.size === 0) return []
  const registrations = await clientSlotRegistrations(entry, root)
  return registrations.some(registration => registration.slot === PLUGIN_PAGE_SLOT) ? [] : [...ids]
}

function clientEntryPlugin(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildClientOptions): Plugin {
  const name = options.logicalName ?? options.packageId
  return {
    name: 'dshx-client-entry',
    enforce: 'pre',
    resolveId(source) {
      if (
        source === VIRTUAL_CLIENT_ENTRY ||
        source === VIRTUAL_CLIENT_API_HOOKS ||
        source === VIRTUAL_CLIENT_SETTINGS_HOOK ||
        source === DSHX_CLIENT_PUBLIC ||
        source === DSHX_API_PUBLIC ||
        source === DSHX_SETTINGS_PUBLIC ||
        source === DSHX_CONVERSATION_PUBLIC
      ) {
        if (source === VIRTUAL_CLIENT_API_HOOKS || source === VIRTUAL_CLIENT_SETTINGS_HOOK) return source
        if (source === DSHX_CLIENT_PUBLIC) return VIRTUAL_CLIENT_PUBLIC
        if (source === DSHX_API_PUBLIC) return `${VIRTUAL_CLIENT_PUBLIC}-api`
        if (source === DSHX_SETTINGS_PUBLIC) return `${VIRTUAL_CLIENT_PUBLIC}-settings`
        if (source === DSHX_CONVERSATION_PUBLIC) return `${VIRTUAL_CLIENT_PUBLIC}-conversation`
        return VIRTUAL_CLIENT_ENTRY
      }
      return null
    },
    async load(id) {
      if (id === VIRTUAL_CLIENT_PUBLIC)
        return [
          `import { ClientContributionModel } from ${JSON.stringify(CLIENT_DEFINE_PATH)}`,
          'export const defineClient = ClientContributionModel.defineClient',
          'export const defineSlot = ClientContributionModel.defineSlot',
          `export { defineClientPlugin } from ${JSON.stringify(CLIENT_SDK_PATH)}`,
          `import { LocaleNamespaceModel } from ${JSON.stringify(CLIENT_LOCALE_PATH)}`,
          'export const declareLocaleNamespace = LocaleNamespaceModel.declareNamespace',
          'export const defineLocale = LocaleNamespaceModel.define',
          'export const plural = LocaleNamespaceModel.plural',
          `import { HostCommandsModel } from ${JSON.stringify(CLIENT_HOST_COMMANDS_PATH)}`,
          'export const hasHostCommandRegistry = HostCommandsModel.hasRegistry',
          'export const runHostCommand = HostCommandsModel.run',
          `export { useApi, useApiQuery } from ${JSON.stringify(VIRTUAL_CLIENT_API_HOOKS)}`,
          `import { ApiRuntimeModel } from ${JSON.stringify(API_RUNTIME_PATH)}`,
          'export const createApiClient = ApiRuntimeModel.createClient',
          'export const createRegisteredApiClient = ApiRuntimeModel.createRegisteredClient',
          `export { useSettings } from ${JSON.stringify(VIRTUAL_CLIENT_SETTINGS_HOOK)}`,
          `import { SettingsPageRendererModel } from ${JSON.stringify(SETTINGS_PAGE_RENDERER_PATH)}`,
          'export const provideSettingsPageRenderer = SettingsPageRendererModel.provide',
          `import { BrowserBroker } from ${JSON.stringify(CLIENT_BROKER_PATH)}`,
          'export const defineContract = BrowserBroker.defineContract',
          'export const defineRegistry = BrowserBroker.defineRegistry',
          'export const contributionFailures = BrowserBroker.failures',
          `import { PluginContextModel } from ${JSON.stringify(CLIENT_PLUGIN_CONTEXT_PATH)}`,
          'export const constantSource = PluginContextModel.constant',
          'export const createSource = PluginContextModel.signal',
          `export { Command, Dialogs, Toasts } from ${JSON.stringify(CLIENT_APP_SERVICES_PATH)}`,
          `export { ComposerAction, HeaderAction, Overlay, Panel, PluginDetailBadge, PluginDetailSection, SessionRowAccessory, SettingsSection } from ${JSON.stringify(CLIENT_REGISTRIES_PATH)}`,
          `import { StoreModel } from ${JSON.stringify(CLIENT_STORE_PATH)}`,
          'export const defineStore = StoreModel.define',
          `import { PluginHooksModel } from ${JSON.stringify(CLIENT_HOOKS_PATH)}`,
          'export const usePlugin = PluginHooksModel.usePlugin',
          'export const useSubscribable = PluginHooksModel.useSubscribable',
          'export const useContract = PluginHooksModel.useContract',
          'export const useRegistry = PluginHooksModel.useRegistry',
          'export const useContributionFailures = PluginHooksModel.useContributionFailures',
          'export const useKeyed = PluginHooksModel.useKeyed',
          'export const useLatest = PluginHooksModel.useLatest',
          '',
        ].join('\n')
      if (id === VIRTUAL_CLIENT_API_HOOKS) {
        return [
          `import { useApi as useApiImplementation, useApiQuery as useApiQueryImplementation } from ${JSON.stringify(CLIENT_API_PATH)}`,
          'export function useApi(...args) { return useApiImplementation(...args) }',
          'export function useApiQuery(...args) { return useApiQueryImplementation(...args) }',
          '',
        ].join('\n')
      }
      if (id === VIRTUAL_CLIENT_SETTINGS_HOOK) {
        return [
          `import { useSettings as useSettingsImplementation } from ${JSON.stringify(SETTINGS_CLIENT_PATH)}`,
          'export function useSettings(...args) { return useSettingsImplementation(...args) }',
          '',
        ].join('\n')
      }
      if (id === `${VIRTUAL_CLIENT_PUBLIC}-api`) {
        return [
          `import { ApiDefinitionModel } from ${JSON.stringify(API_DEFINE_PATH)}`,
          'export const defineApi = ApiDefinitionModel.define',
          'export const DSHX_REGISTRY_OWNER = ApiDefinitionModel.registryOwner',
          'export const dshxRegistryApi = ApiDefinitionModel.registryApi',
          'export const method = ApiDefinitionModel.method',
          `export { isApiError, isApiOwnerMissing, PluginApiError } from ${JSON.stringify(API_COMMON_PATH)}`,
          '',
        ].join('\n')
      }
      if (id === `${VIRTUAL_CLIENT_PUBLIC}-settings`) {
        return [
          `import { SettingsDefinitionModel } from ${JSON.stringify(SETTINGS_DEFINE_PATH)}`,
          'export const defineSettings = SettingsDefinitionModel.define',
          '',
        ].join('\n')
      }
      if (id === `${VIRTUAL_CLIENT_PUBLIC}-conversation`) {
        return [
          `import { ConversationContributionModel } from ${JSON.stringify(CONVERSATION_DEFINE_PATH)}`,
          'export const defineConversation = ConversationContributionModel.define',
          '',
        ].join('\n')
      }
      if (id !== VIRTUAL_CLIENT_ENTRY) return null
      const metadata = {
        packageId: options.packageId,
        logicalName: name,
        sourceFile: relative(paths.root, paths.entry).replaceAll('\\', '/'),
        compatibility: options.compatibility ?? DEFAULT_COMPATIBILITY,
        pluginPageNamespaces: await pluginPageNamespaces(paths.root, paths.entry, options.packageId),
      }
      return [
        `import * as source from ${JSON.stringify(paths.entry)}`,
        `import { createClientModule } from ${JSON.stringify(CLIENT_RUNTIME_PATH)}`,
        `const settingsCapability = globalThis[${JSON.stringify(SETTINGS_CAPABILITY_GLOBAL)}] === true`,
        `const apiCapability = globalThis[${JSON.stringify(API_CAPABILITY_GLOBAL)}] === true`,
        `const plugin = createClientModule(source, { ...${JSON.stringify(metadata)}, settingsCapability, apiCapability })`,
        'export const name = plugin.name',
        'export const inject = plugin.inject',
        'export const Config = plugin.Config',
        'export function apply(ctx, config) { return plugin.apply(ctx, config) }',
        ...(options.sharedRuntime === undefined ? [] : [SharedRuntime.supplierEntryExport()]),
        ...(options.shared === undefined ? [] : [SharedRuntime.consumerEntryImport(options.shared)]),
        '',
      ].join('\n')
    },
  }
}

/**
 * Module membership survives tree-shaking: the public Client module re-exports both hook modules, so a plugin that
 * imports only `defineClient` still lands them in the chunk. Read the exports the bundler actually kept instead.
 */
function retainedHookExports(modules: Record<string, { readonly renderedExports: readonly string[] } | undefined>, virtualId: string): readonly string[] {
  return modules[virtualId]?.renderedExports ?? []
}

/** Infer optional Client capabilities only from code retained in the final chunk. */
function clientCapabilitiesPlugin(options: BuildClientOptions): Plugin {
  return {
    name: 'dshx-client-capabilities',
    enforce: 'post',
    generateBundle(_output, bundle) {
      const chunk = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry)
      if (chunk === undefined || chunk.type !== 'chunk') return
      const settingsRetained = retainedHookExports(chunk.modules, VIRTUAL_CLIENT_SETTINGS_HOOK).length > 0
      const apiRetained = retainedHookExports(chunk.modules, VIRTUAL_CLIENT_API_HOOKS).length > 0
      if (settingsRetained && !(options.inject ?? []).includes(SETTINGS_PROVIDER_PACKAGE)) {
        throw new DshxError('DSHX1203', 'useSettings() requires the official Settings Scope provider package edge.', {
          hint: `Add ${JSON.stringify(SETTINGS_PROVIDER_PACKAGE)} to package.json dsh.client.inject, then rebuild.`,
        })
      }
      if (apiRetained && !(options.inject ?? []).includes(API_PROVIDER_PACKAGE)) {
        throw new DshxError('DSHX1203', 'useApi()/useApiQuery() requires the official Client Connection provider package edge.', {
          hint: `Add ${JSON.stringify(API_PROVIDER_PACKAGE)} to package.json dsh.client.inject, then rebuild.`,
        })
      }
      // Matches both `globalThis["X"] === true` and the minified `globalThis.X===!0`.
      const capabilityExpression = (name: string): RegExp => new RegExp(`globalThis(?:\\[["'\`]${name}["'\`]\\]|\\.${name})\\s*===\\s*(?:true|!0)`, 'g')
      const settingsExpression = capabilityExpression(SETTINGS_CAPABILITY_GLOBAL)
      const apiExpression = capabilityExpression(API_CAPABILITY_GLOBAL)
      chunk.code = chunk.code.replace(settingsExpression, settingsRetained ? 'true' : 'false').replace(apiExpression, apiRetained ? 'true' : 'false')
    },
  }
}

async function validateConversationProviderEdges(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildClientOptions): Promise<void> {
  if (!(await ClientCapabilityAnalysis.usesConversationComponents(paths.entry, paths.root))) return
  const missing = CONVERSATION_PROVIDER_PACKAGES.filter(packageName => !(options.inject ?? []).includes(packageName))
  if (missing.length === 0) return
  throw new DshxError('DSHX1203', 'Conversation components require the official Conversation UI package edge.', {
    file: paths.entry,
    hint: `Add ${missing.map(packageName => JSON.stringify(packageName)).join(' and ')} to package.json dsh.client.inject, then rebuild.`,
  })
}

async function validateLocaleProviderEdge(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildClientOptions): Promise<void> {
  if (!(await ClientCapabilityAnalysis.usesLocales(paths.entry, paths.root)) || (options.inject ?? []).includes(LOCALE_PROVIDER_PACKAGE)) return
  throw new DshxError('DSHX1203', 'defineLocale() contributions require the official Locale provider package edge.', {
    file: paths.entry,
    hint: `Add ${JSON.stringify(LOCALE_PROVIDER_PACKAGE)} to package.json dsh.client.inject, then rebuild.`,
  })
}

const MAX_INJECT_TYPO_DISTANCE = 2

const editDistance = (left: string, right: string): number => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1)
      current.push(Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution))
    }
    previous = current
  }
  return previous[right.length]!
}

/**
 * `dsh.client.inject` lists package names the Loader must load before this
 * Client. A misspelled name never fails on its own: DSH waits for a provider
 * that does not exist and the plugin silently never activates. Names stay
 * open strings, because DSH resolves edges from its own installation and any
 * browser package is a valid edge, so only a name that is not installed here
 * yet sits one typo away from one that is gets refused.
 */
async function validateInjectPackages(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildClientOptions): Promise<void> {
  const inject = options.inject ?? []
  if (inject.length === 0) return
  const resolver = createRequire(resolve(paths.root, 'package.json'))
  const installed = (name: string): boolean =>
    [`${name}/package.json`, name].some(request => {
      try {
        resolver.resolve(request)
        return true
      } catch {
        return false
      }
    })
  const missing = inject.filter(name => !installed(name))
  if (missing.length === 0) return
  const manifest = JSON.parse(await readFile(resolve(paths.root, 'package.json'), 'utf8').catch(() => '{}')) as Record<
    string,
    Record<string, string> | undefined
  >
  const scoped = await readdir(resolve(paths.root, 'node_modules/@deepseek-ai')).catch(() => [] as string[])
  const candidates = [
    ...new Set([
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.dependencies ?? {}),
      ...scoped.map(name => `@deepseek-ai/${name}`),
    ]),
  ].filter(installed)
  for (const name of missing) {
    const suggestion = candidates
      .map(candidate => ({ candidate, distance: editDistance(name, candidate) }))
      .filter(item => item.distance > 0 && item.distance <= MAX_INJECT_TYPO_DISTANCE)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate
    if (suggestion === undefined) continue
    throw new DshxError('DSHX1207', `dsh.client.inject names ${JSON.stringify(name)}, which is not installed; did you mean ${JSON.stringify(suggestion)}?`, {
      file: resolve(paths.root, 'package.json'),
      hint: `Replace it with ${JSON.stringify(suggestion)} in package.json dsh.client.inject. DSH waits for every edge, so a misspelled one keeps the plugin from activating.`,
    })
  }
}

/**
 * A `list` slot addresses entries by `id`, so a plugin that reuses a shipped id
 * lands in the same cell. The cell then renders one occupant and drops the other
 * without any error, which presents as a plugin affordance that is simply never
 * shown. Catching it here turns an invisible runtime absence into a build error.
 */
async function validateSlotOccupancy(paths: Awaited<ReturnType<typeof resolveOptions>>): Promise<void> {
  const conflicts = slotOccupancyConflicts(await clientSlotRegistrations(paths.entry, paths.root))
  const first = conflicts[0]
  if (first === undefined) return
  const identity = first.id === undefined ? (first.key === undefined ? undefined : `key ${JSON.stringify(first.key)}`) : `id ${JSON.stringify(first.id)}`
  throw new DshxError(
    'DSHX1206',
    `Client registers ${JSON.stringify(first.slot)}${identity === undefined ? '' : ` with ${identity}`} and collides with shipped occupant ${JSON.stringify(first.occupant)} at line ${String(first.line)}.`,
    {
      file: first.file,
      hint:
        identity === undefined
          ? 'This single Slot replaces the shipped shell. Register into one of its declared inner Slots, or declare a `priority` only when you intend to replace the shell.'
          : 'Use a distinct id or key to render beside the shipped occupant, or declare a `priority` only when you intend to replace it.',
    },
  )
}

async function validateSetupServiceEdges(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildClientOptions): Promise<void> {
  const analysis = await ClientCapabilityAnalysis.setupServices(paths.entry, paths.root)
  for (const capability of analysis.sdk?.uses ?? []) {
    if (!Object.hasOwn(CLIENT_SDK_PROVIDERS, capability))
      throw new DshxError('DSHX1205', `Unknown Client SDK capability ${JSON.stringify(capability)}.`, {
        file: analysis.sourceFile ?? paths.entry,
        hint: `Choose one of ${Object.keys(CLIENT_SDK_PROVIDERS).join(', ')} in uses.`,
      })
    const missing = CLIENT_SDK_PROVIDERS[capability]!.filter(provider => !(options.inject ?? []).includes(provider))
    if (missing.length)
      throw new DshxError('DSHX1205', `Client capability ${JSON.stringify(capability)} is missing native provider metadata: ${missing.join(', ')}.`, {
        file: paths.entry,
        hint: 'Run "dshx check --fix" to derive the provider metadata from uses, then rebuild.',
      })
  }
  for (const service of analysis.services) {
    if (
      analysis.inject !== undefined &&
      !analysis.inject.includes(service) &&
      !analysis.autoInject.includes(service) &&
      !analysis.runtimeInject.includes(service)
    ) {
      throw new DshxError('DSHX1204', `defineClient().setup uses ctx.${service}, but defineClient.inject does not declare ${JSON.stringify(service)}.`, {
        file: analysis.sourceFile ?? paths.entry,
        hint: `Add inject: [${JSON.stringify(service)}] to defineClient({...}). dsh.client.inject loads provider packages; it does not inject runtime Cordis services.`,
      })
    }
    const descriptor = CLIENT_SETUP_SERVICE_CAPABILITIES[service]
    const provider = descriptor.packageName
    if (descriptor.availability === 'optional' && !(options.inject ?? []).includes(provider) && !analysis.autoInject.includes(service)) {
      throw new DshxError('DSHX1203', `ctx.${service} requires the official ${service} provider package edge.`, {
        file: analysis.sourceFile ?? paths.entry,
        hint: `Add ${JSON.stringify(provider)} to package.json dsh.client.inject, then rebuild.`,
      })
    }
  }
}

/**
 * Locale namespaces are a client-wide singleton, so a claim has to be checked
 * against every other package that can load alongside this one. Shipped
 * namespaces are always reserved; a sibling plugin only conflicts when a profile
 * installs both, which is why the sibling scan is profile-scoped and silent when
 * the profile cannot be resolved.
 */
async function validateLocaleNamespaceOwnership(
  paths: Awaited<ReturnType<typeof resolveOptions>>,
  options: BuildClientOptions,
  siblings: ReadonlyMap<string, readonly string[]>,
): Promise<void> {
  const claimed = await ClientCapabilityAnalysis.localeNamespaces(paths.entry, paths.root)
  if (claimed === undefined || claimed.length === 0) return
  const ownership = LocaleNamespaceOwnershipModel.build(options.packageId)
  for (const [packageId, namespaces] of siblings) LocaleNamespaceOwnershipModel.claim(ownership, packageId, namespaces)
  const conflict = LocaleNamespaceOwnershipModel.findConflict(ownership, claimed)
  if (conflict === undefined) return
  throw new DshxError('DSHX2403', `Locale namespace ${JSON.stringify(conflict.namespace)} is already registered by ${conflict.owner}.`, {
    file: paths.entry,
    hint: conflict.reserved
      ? `${conflict.owner} is a shipped package and always registers this namespace. Declare a namespace you own, such as ${JSON.stringify(`${conflict.namespace}.yourPlugin`)}.`
      : `Profile ${JSON.stringify(options.localeOwnershipProfile)} installs ${conflict.owner} alongside this package. Declare a namespace you own, such as ${JSON.stringify(`${conflict.namespace}.yourPlugin`)}.`,
  })
}

/** Locally installed client plugins that claim a namespace, keyed by package id. */
async function siblingLocaleNamespaces(options: BuildClientOptions): Promise<ReadonlyMap<string, readonly string[]>> {
  const siblings = new Map<string, readonly string[]>()
  if (options.localeOwnershipProfile === undefined) return siblings
  for (const packageId of (await profilePackages(options.localeOwnershipProfile)) ?? []) {
    if (packageId === options.packageId) continue
    const namespaces = await installedLocaleNamespaces(packageId)
    if (namespaces !== undefined && namespaces.length > 0) siblings.set(packageId, namespaces)
  }
  return siblings
}

function clientSetupServiceGuardPlugin(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildClientOptions): Plugin {
  return {
    name: 'dshx-client-setup-service-guard',
    async buildStart() {
      await validateSetupServiceEdges(paths, options)
      await validateLocaleProviderEdge(paths, options)
      await validateLocaleNamespaceOwnership(paths, options, await siblingLocaleNamespaces(options))
    },
  }
}

async function resolveOptions(options: BuildClientOptions) {
  if (options.packageId.trim() === '') {
    throw new DshxError('DSHX1001', 'Client package id must not be empty.')
  }
  if (options.logicalName !== undefined && options.logicalName.trim() === '') {
    throw new DshxError('DSHX1001', 'Logical Client name must not be empty.')
  }
  const root = await realpath(resolve(options.root ?? process.cwd()))
  const unresolvedEntry = resolve(root, options.entry)
  const outDir = resolve(root, options.outDir)
  const entry = await realpath(unresolvedEntry).catch((cause: unknown) => {
    throw new DshxError('DSHX1002', `Client entry does not exist: ${unresolvedEntry}`, { cause, file: unresolvedEntry })
  })
  if (outDir === root || isInside(outDir, entry)) {
    throw new DshxError('DSHX1003', `Client output directory ${outDir} would overwrite project sources.`, {
      hint: 'Choose a dedicated output directory such as dist.',
    })
  }
  return { root, entry, outDir }
}

async function clientConfig(paths: Awaited<ReturnType<typeof resolveOptions>>, options: BuildClientOptions, watch: boolean): Promise<InlineConfig> {
  const compatibility = options.compatibility ?? DEFAULT_COMPATIBILITY
  const externals = new Set([...compatibility.client.platformModules, ...compatibility.client.preloadedExternals, ...(options.external ?? [])])
  const bundleDependencies = options.bundleDependencies ?? []
  const protectedModules = [...compatibility.client.platformModules, ...compatibility.client.preloadedExternals]
  if (bundleDependencies.some(dependency => protectedModules.some(source => source === dependency || source.startsWith(`${dependency}/`)))) {
    throw new DshxError('DSHX4004', 'Client bundleDependencies cannot replace platform module identities.')
  }
  const isBundled = (source: string): boolean => bundleDependencies.some(dependency => source === dependency || source.startsWith(`${dependency}/`))
  const external = (source: string): boolean => externals.has(source) && !isBundled(source)
  const supplier =
    options.shared === undefined
      ? undefined
      : await SharedRuntime.readSupplier({ root: paths.root, supplier: options.shared, external: options.external ?? [] })
  let sheetHash: string | undefined
  const assetsInlineLimit = (): boolean => true
  const output = {
    format: 'cjs',
    entryFileNames: 'client.js',
    codeSplitting: false,
    exports: 'named',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(options.packageId)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  } as const
  const userPlugins = await CompilerKernel.resolveUserPlugins(options.vite?.plugins, watch)
  const mode = watch ? 'development' : 'production'
  return {
    root: paths.root,
    configFile: false,
    publicDir: false,
    appType: 'custom',
    mode,
    logLevel: 'error',
    plugins: [
      clientEntryPlugin(paths, options),
      ...(watch ? [clientSetupServiceGuardPlugin(paths, options)] : []),
      clientGuardPlugin(externals, options.packageId, bundleDependencies),
      ...userPlugins,
      CompilerKernel.artifactDeclarationPlugin('client', paths.outDir, options.declarations ?? true),
      CompilerKernel.dependencyManifestPlugin({ face: 'client', root: paths.root, outDir: paths.outDir, entryFile: 'client.js' }),
      ...(supplier === undefined || options.shared === undefined
        ? []
        : [SharedRuntime.consumerPlugin({ supplier: options.shared, modules: supplier.modules, bundleDependencies })]),
      ...(options.sharedRuntime === undefined
        ? []
        : [
            SharedRuntime.supplierPlugin({
              packageId: options.packageId,
              root: paths.root,
              provide: options.sharedRuntime,
              outDir: paths.outDir,
              cssHash: () => sheetHash,
            }),
          ]),
      clientCssPlugin({
        packageId: options.packageId,
        outDir: paths.outDir,
        suppliedHash: supplier?.cssHash,
        onSheet: hash => {
          sheetHash = hash
        },
      }),
      clientCapabilitiesPlugin(options),
      CompilerKernel.boundaryPlugin({
        face: 'client',
        root: paths.root,
        input: VIRTUAL_CLIENT_ENTRY,
        target: 'es2024',
        assetsInlineLimit,
        external,
        output,
        cssCodeSplit: false,
      }),
      singleClientChunkPlugin(),
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'import.meta.env.MODE': JSON.stringify(mode),
      'import.meta.env': JSON.stringify({ MODE: mode }),
    },
    oxc: {
      jsx: {
        runtime: 'automatic',
        development: false,
      },
    },
    build: {
      target: 'es2024',
      outDir: paths.outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      cssCodeSplit: false,
      assetsInlineLimit,
      minify: !watch && options.minify === true,
      sourcemap: options.sourcemap ?? true,
      watch: null,
      rollupOptions: {
        input: VIRTUAL_CLIENT_ENTRY,
        preserveEntrySignatures: 'strict',
        external,
        output,
      },
    },
  }
}

/** Start a Client watcher without awaiting a successful initial build. */
export async function watchClient(options: BuildClientOptions): Promise<BuildWatcher> {
  const paths = await resolveOptions(options)
  await validateSlotOccupancy(paths)
  await validateInjectPackages(paths, options)
  await validateSetupServiceEdges(paths, options)
  await validateLocaleProviderEdge(paths, options)
  await validateConversationProviderEdges(paths, options)
  await validateLocaleNamespaceOwnership(paths, options, await siblingLocaleNamespaces(options))
  const config = await clientConfig(paths, options, true)
  return CompilerKernel.buildWatcher(
    await build({
      ...config,
      build: { ...config.build, watch: {} },
    }),
    'client',
    'DSHX1104',
  )
}

/** Build a DSH-compatible client factory with Vite/Rolldown. */
export async function buildClient(options: BuildClientOptions): Promise<ClientBuildResult> {
  const paths = await resolveOptions(options)
  await validateSlotOccupancy(paths)
  await validateInjectPackages(paths, options)
  await validateSetupServiceEdges(paths, options)
  await validateLocaleProviderEdge(paths, options)
  await validateConversationProviderEdges(paths, options)
  await validateLocaleNamespaceOwnership(paths, options, await siblingLocaleNamespaces(options))
  const config = await clientConfig(paths, options, false)
  const declarations = options.declarations ?? true
  return CompilerKernel.buildReport(await build(config), 'client', 'client.js', paths.outDir, declarations, 'DSHX1103')
}
