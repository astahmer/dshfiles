import { access, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { loadConfigFromFile } from 'vite'
import { DshxError } from '../diagnostics.js'
import { resolveVitePlugins } from './vite-plugins.js'
import type { DshxConfig, DshxModuleEntry, ResolvedDshxConfig, ResolveDshxConfigOptions } from './types.js'

const CONFIG_FILENAME = 'dshx.config.ts'
const PACKAGE_FILENAME = 'package.json'
const TOP_LEVEL_KEYS = new Set(['name', 'host', 'client', 'modules', 'profile', 'dev', 'build', 'compatibility'])
const FACE_KEYS = new Set(['entry', 'vite'])
const HOST_FACE_KEYS = new Set([...FACE_KEYS, 'bundleDependencies'])
const CLIENT_FACE_KEYS = new Set([...HOST_FACE_KEYS, 'shared', 'sharedRuntime'])
const VITE_KEYS = new Set(['plugins'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  )
}

async function findProjectRoot(cwd: string): Promise<string> {
  let current = await realpath(resolve(cwd)).catch((cause: unknown) => {
    throw new DshxError('DSHX4001', `Cannot resolve project directory: ${resolve(cwd)}`, { cause, file: resolve(cwd) })
  })
  while (true) {
    if (await exists(resolve(current, PACKAGE_FILENAME))) return current
    const parent = dirname(current)
    if (parent === current) {
      throw new DshxError('DSHX4001', `No package.json was found from ${JSON.stringify(cwd)} upward.`, {
        file: resolve(cwd),
        hint: 'Run DSHX inside a plugin package.',
      })
    }
    current = parent
  }
}

async function readManifest(packageFile: string): Promise<Record<string, unknown>> {
  let source: string
  try {
    source = await readFile(packageFile, 'utf8')
  } catch (cause) {
    throw new DshxError('DSHX4002', `Cannot read project manifest: ${packageFile}`, { cause, file: packageFile })
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (cause) {
    throw new DshxError('DSHX4002', `Project manifest is not valid JSON: ${packageFile}`, { cause, file: packageFile })
  }
  if (!isObject(value)) {
    throw new DshxError('DSHX4002', 'Project package.json must contain a JSON object.', { file: packageFile })
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    throw new DshxError('DSHX4002', 'Project package.json must declare a non-empty string name.', {
      file: packageFile,
      hint: 'Use the installable package id, for example "@scope/my-plugin".',
    })
  }
  return value
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string, file: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    throw new DshxError('DSHX4004', `${label} contains unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`, {
      file,
      hint: 'Remove the field or move runtime behavior into Host/Client source code.',
    })
  }
}

function optionalNonEmptyString(value: unknown, field: string, file: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DshxError('DSHX4004', `${field} must be a non-empty string.`, {
      file,
      hint: `Set ${field} to a non-empty string or remove it to use the default.`,
    })
  }
  return value
}

function optionalPackageNames(value: unknown, field: string, file: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new DshxError('DSHX4004', `${field} must be an array of bare package roots.`, {
      file,
      hint: 'List package roots such as "@scope/package"; subpaths and Cordis are not allowed.',
    })
  }
  const names = value.filter((name): name is string => typeof name === 'string')
  const packageName = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
  if (
    names.length !== value.length ||
    names.some(name => !packageName.test(name)) ||
    new Set(names).size !== names.length ||
    names.includes('@deepseek-ai/cordis')
  ) {
    throw new DshxError('DSHX4004', `${field} must contain unique bare package roots and cannot bundle Cordis.`, {
      file,
      hint: 'Use unique package roots such as "@scope/package". DSHX keeps the Host Cordis identity external.',
    })
  }
  return names
}

function validateSharedRuntime(client: Record<string, unknown>, file: string): void {
  const packageName = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/
  if (client.shared !== undefined && (typeof client.shared !== 'string' || !packageName.test(client.shared))) {
    throw new DshxError('DSHX4004', 'client.shared must be the package id of a shared-runtime supplier.', {
      file,
      hint: 'Use client: { shared: "@scope/shared-runtime" }.',
    })
  }
  if (client.sharedRuntime === undefined) return
  if (client.shared !== undefined) {
    throw new DshxError('DSHX4004', 'client.shared and client.sharedRuntime cannot be combined.', {
      file,
      hint: 'A supplier provides modules; a consumer uses them. Keep one role per package.',
    })
  }
  const provide = isObject(client.sharedRuntime) ? client.sharedRuntime.provide : undefined
  if (
    !isObject(client.sharedRuntime) ||
    !Array.isArray(provide) ||
    provide.length === 0 ||
    provide.some(name => typeof name !== 'string' || name.trim() !== name || name === '' || name.startsWith('.') || name.startsWith('@deepseek-ai/cordis')) ||
    new Set(provide).size !== provide.length
  ) {
    throw new DshxError('DSHX4004', 'client.sharedRuntime.provide must list unique bare module specifiers.', {
      file,
      hint: 'Use client: { sharedRuntime: { provide: ["zod", "@tanstack/react-query"] } }.',
    })
  }
  rejectUnknownKeys(client.sharedRuntime, new Set(['provide']), 'client.sharedRuntime', file)
}

function validateConfig(value: unknown, file: string): DshxConfig {
  if (!isObject(value)) {
    throw new DshxError('DSHX4003', 'dshx.config.ts must default-export an object.', {
      file,
      hint: 'Default-export an object accepted by defineConfig().',
    })
  }
  rejectUnknownKeys(value, TOP_LEVEL_KEYS, 'DSHX config', file)

  optionalNonEmptyString(value.name, 'name', file)
  optionalNonEmptyString(value.profile, 'profile', file)
  for (const field of ['host', 'client'] as const) {
    const candidate = value[field]
    if (candidate === undefined || candidate === false) continue
    if (!isObject(candidate)) {
      throw new DshxError('DSHX4004', `${field} must be false or an object.`, {
        file,
        hint: `Replace the removed string shorthand with ${field}: { entry: "src/${field}.ts${field === 'client' ? 'x' : ''}" }.`,
      })
    }
    rejectUnknownKeys(candidate, field === 'client' ? CLIENT_FACE_KEYS : HOST_FACE_KEYS, field, file)
    optionalNonEmptyString(candidate.entry, `${field}.entry`, file)
    optionalPackageNames(candidate.bundleDependencies, `${field}.bundleDependencies`, file)
    if (candidate.vite !== undefined) {
      if (!isObject(candidate.vite)) {
        throw new DshxError('DSHX4004', `${field}.vite must be an object.`, {
          file,
          hint: `Use ${field}: { vite: { plugins: [plugin()] } }.`,
        })
      }
      rejectUnknownKeys(candidate.vite, VITE_KEYS, `${field}.vite`, file)
      if (candidate.vite.plugins !== undefined && !Array.isArray(candidate.vite.plugins)) {
        throw new DshxError('DSHX4004', `${field}.vite.plugins must be an array of Vite PluginOption values.`, {
          file,
          hint: 'Call each plugin factory separately for Host and Client.',
        })
      }
    }
  }

  if (isObject(value.client)) validateSharedRuntime(value.client, file)

  if (value.dev !== undefined) {
    if (!isObject(value.dev)) {
      throw new DshxError('DSHX4004', 'dev must be an object.', { file, hint: 'Use dev: { hostRestart: "manual" | "auto" }.' })
    }
    rejectUnknownKeys(value.dev, new Set(['hostRestart']), 'dev', file)
    if (value.dev.hostRestart !== undefined && value.dev.hostRestart !== 'manual' && value.dev.hostRestart !== 'auto') {
      throw new DshxError('DSHX4004', 'dev.hostRestart must be "manual" or "auto".', {
        file,
        hint: 'Choose "manual" or "auto", or remove the field to use "auto".',
      })
    }
  }
  if (value.build !== undefined) {
    if (!isObject(value.build)) {
      throw new DshxError('DSHX4004', 'build must be an object.', {
        file,
        hint: 'Use build: { sourcemap: true | false, declarations: true | false, minify: true | false }.',
      })
    }
    rejectUnknownKeys(value.build, new Set(['sourcemap', 'declarations', 'minify']), 'build', file)
    if (value.build.sourcemap !== undefined && typeof value.build.sourcemap !== 'boolean') {
      throw new DshxError('DSHX4004', 'build.sourcemap must be a boolean.', {
        file,
        hint: 'Set build.sourcemap to true or false.',
      })
    }
    if (value.build.minify !== undefined && typeof value.build.minify !== 'boolean') {
      throw new DshxError('DSHX4004', 'build.minify must be a boolean.', {
        file,
        hint: 'Set build.minify to true or false.',
      })
    }
    if (value.build.declarations !== undefined && typeof value.build.declarations !== 'boolean') {
      throw new DshxError('DSHX4004', 'build.declarations must be a boolean.', {
        file,
        hint: 'Set build.declarations to true or false.',
      })
    }
  }
  if (value.compatibility !== undefined) {
    if (!isObject(value.compatibility)) {
      throw new DshxError('DSHX4004', 'compatibility must be an object.', {
        file,
        hint: 'Use compatibility: { allowUnsupported: true | false }.',
      })
    }
    rejectUnknownKeys(value.compatibility, new Set(['allowUnsupported']), 'compatibility', file)
    if (value.compatibility.allowUnsupported !== undefined && typeof value.compatibility.allowUnsupported !== 'boolean') {
      throw new DshxError('DSHX4004', 'compatibility.allowUnsupported must be a boolean.', {
        file,
        hint: 'Set compatibility.allowUnsupported to true or false.',
      })
    }
  }
  return value as DshxConfig
}

async function loadUserConfig(root: string): Promise<{
  config: DshxConfig
  configFile?: string
  dependencies: string[]
}> {
  const file = resolve(root, CONFIG_FILENAME)
  if (!(await exists(file))) return { config: {}, dependencies: [] }
  let loaded: Awaited<ReturnType<typeof loadConfigFromFile>>
  try {
    loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, file, root, 'silent', undefined, 'bundle')
  } catch (cause) {
    throw new DshxError('DSHX4003', `Failed to load ${CONFIG_FILENAME}; it must default-export a configuration object.`, {
      cause,
      file,
      hint: 'Fix the TypeScript error and default-export an object accepted by defineConfig().',
    })
  }
  if (loaded === null) {
    throw new DshxError('DSHX4003', `Failed to load ${CONFIG_FILENAME}.`, {
      file,
      hint: 'Fix the TypeScript error and default-export an object accepted by defineConfig().',
    })
  }
  return {
    config: validateConfig(loaded.config, loaded.path),
    configFile: loaded.path,
    dependencies: [...loaded.dependencies],
  }
}

function isInside(root: string, file: string): boolean {
  const path = relative(root, file)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

async function resolveEntry(
  root: string,
  configured: false | { readonly entry?: string } | undefined,
  convention: string,
  field: 'host' | 'client' | `modules.${string}`,
  configFile: string | undefined,
): Promise<string | undefined> {
  if (configured === false) return undefined
  const explicit = configured !== undefined
  const unresolved = resolve(root, configured?.entry ?? convention)
  if (!explicit && !(await exists(unresolved))) return undefined
  const entry = await realpath(unresolved).catch((cause: unknown) => {
    throw new DshxError('DSHX4005', `${field} entry does not exist: ${unresolved}`, {
      cause,
      file: configFile ?? unresolved,
      hint: field.startsWith('modules.') ? `Create the file or remove modules.${field.slice('modules.'.length)}.` : `Create the file or set ${field}: false.`,
    })
  })
  if (!isInside(root, entry)) {
    throw new DshxError('DSHX4005', `${field} entry must stay inside the project root: ${entry}`, {
      file: configFile ?? entry,
      hint: field.startsWith('modules.') ? `Move the entry under ${root}.` : `Move the entry under ${root} or set ${field}: false.`,
    })
  }
  return entry
}

function immediatePlugins(value: DshxConfig['host'] | DshxConfig['client']): readonly import('vite').PluginOption[] {
  return value === false || value === undefined ? [] : (value.vite?.plugins ?? [])
}

/** Discover and normalize one DSHX project without changing its files. */
export async function resolveDshxConfig(options: ResolveDshxConfigOptions = {}): Promise<ResolvedDshxConfig> {
  const root = await findProjectRoot(options.cwd ?? process.cwd())
  const packageFile = resolve(root, PACKAGE_FILENAME)
  const manifest = await readManifest(packageFile)
  const loaded = await loadUserConfig(root)
  const hostVitePlugins = immediatePlugins(loaded.config.host)
  const clientVitePlugins = immediatePlugins(loaded.config.client)
  const hostPluginObjects = new Set(await resolveVitePlugins(hostVitePlugins))
  if ((await resolveVitePlugins(clientVitePlugins)).some(plugin => hostPluginObjects.has(plugin))) {
    throw new DshxError('DSHX4004', 'Host and Client cannot reuse the same stateful Vite plugin instance.', {
      file: loaded.configFile ?? packageFile,
      hint: 'Call the plugin factory separately in host.vite.plugins and client.vite.plugins.',
    })
  }
  const MODULE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u
  /** Artifact names the Host and Client faces already own. */
  const RESERVED_MODULE_NAMES = new Set(['index', 'client', 'package', 'cordis'])

  /** Resolve the extra shared entry points other plugins import. */
  async function resolveModules(
    root: string,
    modules: Readonly<Record<string, string>> | undefined,
    configFile: string | undefined,
  ): Promise<readonly DshxModuleEntry[]> {
    const resolved: DshxModuleEntry[] = []
    for (const [name, entry] of Object.entries(modules ?? {})) {
      if (!MODULE_NAME_PATTERN.test(name) || RESERVED_MODULE_NAMES.has(name)) {
        throw new DshxError('DSHX4007', `Invalid shared module name ${JSON.stringify(name)}.`, {
          ...(configFile === undefined ? {} : { file: configFile }),
          hint: 'Use a lower-case name such as "contract"; "index", "client", "package" and "cordis" are reserved.',
        })
      }
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new DshxError('DSHX4007', `Shared module ${JSON.stringify(name)} needs a source entry.`, {
          ...(configFile === undefined ? {} : { file: configFile }),
        })
      }
      const absolute = await resolveEntry(root, { entry }, 'src/module.ts', `modules.${name}`, configFile)
      if (absolute === undefined) {
        throw new DshxError('DSHX4007', `Shared module ${JSON.stringify(name)} has no entry.`, {
          ...(configFile === undefined ? {} : { file: configFile }),
        })
      }
      resolved.push({ name, entry: absolute })
    }
    return resolved
  }

  const hostEntry = await resolveEntry(root, loaded.config.host, 'src/host.ts', 'host', loaded.configFile)
  const clientEntry = await resolveEntry(root, loaded.config.client, 'src/client.tsx', 'client', loaded.configFile)
  const hostBundleDependencies = loaded.config.host === false ? [] : (loaded.config.host?.bundleDependencies ?? [])
  if (hostEntry === undefined && clientEntry === undefined) {
    throw new DshxError('DSHX4006', 'No Host or Client entry is enabled for this project.', {
      file: loaded.configFile ?? packageFile,
      hint: 'Create src/host.ts or src/client.tsx, or configure an explicit entry.',
    })
  }
  const modules = await resolveModules(root, loaded.config.modules, loaded.configFile)
  const packageId = manifest.name as string
  return {
    root,
    packageFile,
    ...(loaded.configFile === undefined ? {} : { configFile: loaded.configFile }),
    configDependencies: loaded.dependencies,
    packageId,
    name: loaded.config.name ?? packageId,
    ...(hostEntry === undefined ? {} : { hostEntry }),
    ...(clientEntry === undefined ? {} : { clientEntry }),
    hostBundleDependencies,
    ...(modules.length === 0 ? {} : { modules }),
    clientBundleDependencies: loaded.config.client === false ? [] : (loaded.config.client?.bundleDependencies ?? []),
    ...(loaded.config.client === false || loaded.config.client?.shared === undefined ? {} : { clientShared: loaded.config.client.shared }),
    ...(loaded.config.client === false || loaded.config.client?.sharedRuntime === undefined
      ? {}
      : { clientSharedRuntime: loaded.config.client.sharedRuntime.provide }),
    ...(hostVitePlugins.length === 0 ? {} : { hostVitePlugins }),
    ...(clientVitePlugins.length === 0 ? {} : { clientVitePlugins }),
    outDir: resolve(root, 'dist'),
    profile: loaded.config.profile ?? 'web',
    dev: { hostRestart: loaded.config.dev?.hostRestart ?? 'auto' },
    build: {
      sourcemap: loaded.config.build?.sourcemap ?? true,
      declarations: loaded.config.build?.declarations ?? true,
      minify: loaded.config.build?.minify ?? false,
    },
    compatibility: { allowUnsupported: loaded.config.compatibility?.allowUnsupported ?? false },
    manifest,
  }
}
