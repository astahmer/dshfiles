import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { DEFAULT_COMPATIBILITY } from '../compat/index.js'
import type { DshCompatibility } from '../compat/types.js'
import { CLIENT_SETUP_SERVICE_CAPABILITIES, CLIENT_SDK_PROVIDERS, ClientCapabilityAnalysis } from '../compiler/client/capabilities.js'
import { LocaleNamespaceOwnershipModel } from '../compiler/client/locale-ownership.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic, DshxDiagnosticSeverity } from '../diagnostics.js'
import { decodeJson, decodeJsonSafe, jsonObjectSchema, jsonValueSchema } from '../json.js'
import type { JsonObject, JsonValue } from '../json.js'
import { projectHostProvidedDependencyDiagnostics } from '../compat/index.js'
import { featureCatalogIssues } from './features.js'

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(code: string, severity: DshxDiagnosticSeverity, message: string, file: string, hint: string): DshxDiagnostic {
  return { code, severity, message, file, hint }
}

const conditionalTargetObjectSchema = z.looseObject({ default: z.string() })
const conditionalTargetStringSchema = z.string()

function parseConditionalTarget(value: unknown): string | undefined {
  const target = conditionalTargetStringSchema.safeParse(value)
  if (target.success) return target.data
  const conditional = conditionalTargetObjectSchema.safeParse(value)
  return conditional.success ? conditional.data.default : undefined
}

function parseExportTarget(exportsField: unknown, subpath: string): string | undefined {
  if (subpath === '.' && (typeof exportsField === 'string' || (isObject(exportsField) && 'default' in exportsField))) {
    return parseConditionalTarget(exportsField)
  }
  if (!isObject(exportsField)) return undefined
  return parseConditionalTarget(exportsField[subpath])
}

function checkExport(diagnostics: DshxDiagnostic[], exportsField: unknown, subpath: string, expected: string, code: string, file: string): void {
  const actual = parseExportTarget(exportsField, subpath)
  if (actual === expected) return
  diagnostics.push(
    issue(
      code,
      'error',
      `package.json exports[${JSON.stringify(subpath)}] must resolve to ${JSON.stringify(expected)}.`,
      file,
      actual === undefined ? 'Add the required package export.' : `Replace ${JSON.stringify(actual)} with ${JSON.stringify(expected)}.`,
    ),
  )
}

function checkStringArray(diagnostics: DshxDiagnostic[], value: unknown, field: string, code: string, file: string): string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    diagnostics.push(issue(code, 'error', `${field} must be an array of strings.`, file, `Set ${field} to an array, or use [] when it has no entries.`))
    return undefined
  }
  const valid: string[] = []
  let invalid = false
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item !== item.trim()) invalid = true
    else valid.push(item)
  }
  if (invalid) {
    diagnostics.push(
      issue(
        code,
        'error',
        `${field} entries must be non-empty strings without surrounding whitespace.`,
        file,
        'Remove non-string and empty entries, and trim surrounding whitespace.',
      ),
    )
  }
  const duplicates = [...new Set(valid.filter((item, index) => valid.indexOf(item) !== index))]
  if (duplicates.length > 0) {
    diagnostics.push(
      issue(code, 'error', `${field} contains duplicate entries: ${duplicates.join(', ')}.`, file, 'Keep each package or module request only once.'),
    )
  }
  return invalid ? undefined : valid
}

async function checkPatch(diagnostics: DshxDiagnostic[], root: string, packageFile: string): Promise<void> {
  const patchFile = resolve(root, 'cordis.patch.yml')
  let source: string
  try {
    source = await readFile(patchFile, 'utf8')
  } catch {
    diagnostics.push(
      issue(
        'DSHX4123',
        'error',
        'The declared bundle patch cordis.patch.yml does not exist.',
        packageFile,
        'Create cordis.patch.yml with a top-level YAML array.',
      ),
    )
    return
  }
  let value: unknown
  try {
    value = parse(source)
  } catch (error) {
    diagnostics.push(
      issue(
        'DSHX4124',
        'error',
        `cordis.patch.yml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
        patchFile,
        'Fix the YAML syntax and keep patch operations in a top-level array.',
      ),
    )
    return
  }
  if (!Array.isArray(value)) {
    diagnostics.push(
      issue(
        'DSHX4124',
        'error',
        'cordis.patch.yml must contain a top-level YAML array.',
        patchFile,
        'Prefix each patch operation with "-" so the document root is an array.',
      ),
    )
  }
}

function checkPublishingHints(diagnostics: DshxDiagnostic[], manifest: JsonObject, file: string): void {
  if (manifest.main !== './dist/index.js') {
    diagnostics.push(
      issue(
        'DSHX4190',
        'warning',
        'package.json main should point to "./dist/index.js" for legacy Node resolution.',
        file,
        'Set main to "./dist/index.js" before publishing.',
      ),
    )
  }
  const files = Array.isArray(manifest.files)
    ? manifest.files.filter((value): value is string => typeof value === 'string').map(value => value.replace(/^\.\//, '').replace(/\/$/, ''))
    : []
  const missing = ['dist', 'cordis.patch.yml'].filter(value => !files.includes(value))
  if (missing.length > 0) {
    diagnostics.push(
      issue(
        'DSHX4191',
        'warning',
        `package.json files should include: ${missing.join(', ')}.`,
        file,
        'Published packages need both compiled artifacts and the bundle patch.',
      ),
    )
  }
}

function checkClient(diagnostics: DshxDiagnostic[], config: ResolvedDshxConfig, manifest: JsonObject, compatibility: DshCompatibility): void {
  const file = config.packageFile
  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const declaration = dsh?.client
  if (config.clientEntry === undefined) {
    if (declaration !== undefined) {
      diagnostics.push(
        issue(
          'DSHX4201',
          'error',
          'Client is disabled but package.json still declares dsh.client.',
          file,
          'Enable a Client entry or remove dsh.client so DSH does not load a missing bundle.',
        ),
      )
    }
    return
  }

  checkExport(diagnostics, manifest.exports, './client', './dist/client.js', 'DSHX4210', file)
  if (!isObject(declaration)) {
    diagnostics.push(
      issue(
        'DSHX4211',
        'error',
        'Client projects must declare an object at dsh.client.',
        file,
        'Add dsh.client with platform, inject, external, and immediately metadata.',
      ),
    )
    return
  }
  if (declaration.platform !== compatibility.client.manifest.platform) {
    diagnostics.push(
      issue(
        'DSHX4211',
        'error',
        `dsh.client.platform must be ${JSON.stringify(compatibility.client.manifest.platform)}.`,
        file,
        `Set dsh.client.platform to ${JSON.stringify(compatibility.client.manifest.platform)}.`,
      ),
    )
  }
  const inject = checkStringArray(diagnostics, declaration.inject, 'dsh.client.inject', 'DSHX4212', file)
  const locales = checkStringArray(diagnostics, declaration.locales, 'dsh.client.locales', 'DSHX4225', file)
  const peers = isObject(manifest.peerDependencies) ? manifest.peerDependencies : {}
  for (const provider of inject ?? []) {
    if (provider in peers) continue
    diagnostics.push(
      issue(
        'DSHX4224',
        'warning',
        `dsh.client.inject loads ${JSON.stringify(provider)}, but peerDependencies does not declare it.`,
        file,
        `Add ${JSON.stringify(provider)}: ${JSON.stringify(compatibility.dshRange)} to peerDependencies so the plugin states every Host package it loads.`,
      ),
    )
  }
  const external = checkStringArray(diagnostics, declaration.external, 'dsh.client.external', 'DSHX4213', file)
  if (declaration.immediately !== undefined && typeof declaration.immediately !== 'boolean') {
    diagnostics.push(
      issue(
        'DSHX4214',
        'error',
        'dsh.client.immediately must be a boolean.',
        file,
        'Set dsh.client.immediately to true or false, or remove the optional field.',
      ),
    )
  }
  if (locales !== undefined) {
    const ownership = LocaleNamespaceOwnershipModel.build(config.packageId)
    const conflict = LocaleNamespaceOwnershipModel.findConflict(ownership, locales)
    if (conflict !== undefined) {
      diagnostics.push(
        issue(
          'DSHX4226',
          'error',
          `Locale namespace ${JSON.stringify(conflict.namespace)} is already registered by ${conflict.owner}.`,
          file,
          conflict.reserved
            ? `The Locale runtime keeps one dictionary per namespace and locale for the whole client, and ${conflict.owner} is a shipped package. Declare a namespace you own, such as ${JSON.stringify(`${conflict.namespace}.yourPlugin`)}.`
            : `The Locale runtime keeps one dictionary per namespace and locale for the whole client, and this profile installs ${conflict.owner}. Declare a namespace you own, such as ${JSON.stringify(`${conflict.namespace}.yourPlugin`)}.`,
        ),
      )
    }
  }
  if (config.clientShared !== undefined && !(external ?? []).includes(config.clientShared)) {
    diagnostics.push(
      issue(
        'DSHX4233',
        'error',
        `client.shared uses ${JSON.stringify(config.clientShared)}, but dsh.client.external does not request it.`,
        file,
        `Add ${JSON.stringify(config.clientShared)} to dsh.client.external so the Host loads the shared-runtime supplier before this package.`,
      ),
    )
  }
  if (external === undefined) return

  const baseline = new Set([...compatibility.client.platformModules, ...compatibility.client.preloadedExternals])
  for (const request of external) {
    if (request === config.packageId || request.startsWith(`${config.packageId}/`)) {
      diagnostics.push(
        issue(
          'DSHX4215',
          'error',
          `dsh.client.external must not request its own package: ${JSON.stringify(request)}.`,
          file,
          'Remove self-references from dsh.client.external.',
        ),
      )
    } else if (baseline.has(request)) {
      diagnostics.push(
        issue(
          'DSHX4215',
          'error',
          `dsh.client.external must not repeat the ${compatibility.id} baseline module ${JSON.stringify(request)}.`,
          file,
          'Remove baseline modules; DSH provides them implicitly.',
        ),
      )
    }
  }
}

async function checkSettingsCapability(diagnostics: DshxDiagnostic[], config: ResolvedDshxConfig, manifest: JsonObject): Promise<void> {
  if (config.clientEntry === undefined || !(await ClientCapabilityAnalysis.usesSettings(config.clientEntry, config.root))) return
  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const client = isObject(dsh?.client) ? dsh.client : undefined
  const inject = Array.isArray(client?.inject) ? client.inject : []
  if (inject.includes('@deepseek-ai/dsh-client-ui-settings')) return
  diagnostics.push(
    issue(
      'DSHX4216',
      'error',
      'useSettings() requires @deepseek-ai/dsh-client-ui-settings in dsh.client.inject.',
      config.packageFile,
      'Add "@deepseek-ai/dsh-client-ui-settings" to dsh.client.inject so DSH loads the native settings form provider first.',
    ),
  )
}

async function checkApiCapability(diagnostics: DshxDiagnostic[], config: ResolvedDshxConfig, manifest: JsonObject): Promise<void> {
  if (config.clientEntry === undefined || !(await ClientCapabilityAnalysis.usesApi(config.clientEntry, config.root))) return
  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const client = isObject(dsh?.client) ? dsh.client : undefined
  const inject = Array.isArray(client?.inject) ? client.inject : []
  if (inject.includes('@deepseek-ai/dsh-client-connection')) return
  diagnostics.push(
    issue(
      'DSHX4218',
      'error',
      'useApi()/useApiQuery() requires @deepseek-ai/dsh-client-connection in dsh.client.inject.',
      config.packageFile,
      'Add "@deepseek-ai/dsh-client-connection" to dsh.client.inject so DSH loads the official connection provider first.',
    ),
  )
}

async function checkConversationCapability(diagnostics: DshxDiagnostic[], config: ResolvedDshxConfig, manifest: JsonObject): Promise<void> {
  if (config.clientEntry === undefined || !(await ClientCapabilityAnalysis.usesConversationComponents(config.clientEntry, config.root))) return
  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const client = isObject(dsh?.client) ? dsh.client : undefined
  const inject = Array.isArray(client?.inject) ? client.inject : []
  const required = ['@deepseek-ai/dsh-client-ui-conversation'] as const
  const missing = required.filter(packageName => !inject.includes(packageName))
  if (missing.length === 0) return
  diagnostics.push(
    issue(
      'DSHX4217',
      'error',
      'Conversation components require the official Conversation UI package edge.',
      config.packageFile,
      `Add ${missing.map(packageName => JSON.stringify(packageName)).join(' and ')} to dsh.client.inject before building the Client.`,
    ),
  )
}

async function checkLocaleCapability(diagnostics: DshxDiagnostic[], config: ResolvedDshxConfig, manifest: JsonObject): Promise<void> {
  if (config.clientEntry === undefined || !(await ClientCapabilityAnalysis.usesLocales(config.clientEntry, config.root))) return
  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const client = isObject(dsh?.client) ? dsh.client : undefined
  const inject = Array.isArray(client?.inject) ? client.inject : []
  if (inject.includes('@deepseek-ai/dsh-client-locale')) return
  diagnostics.push(
    issue(
      'DSHX4221',
      'error',
      'defineLocale() contributions require @deepseek-ai/dsh-client-locale in dsh.client.inject.',
      config.packageFile,
      'Add "@deepseek-ai/dsh-client-locale" to dsh.client.inject so DSH loads the official Locale provider first.',
    ),
  )
}

async function checkSetupServiceCapabilities(diagnostics: DshxDiagnostic[], config: ResolvedDshxConfig, manifest: JsonObject): Promise<void> {
  if (config.clientEntry === undefined) return
  const analysis = await ClientCapabilityAnalysis.setupServices(config.clientEntry, config.root)
  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const client = isObject(dsh?.client) ? dsh.client : undefined
  const packageInject = Array.isArray(client?.inject) ? client.inject : []
  if (analysis.sdk !== undefined && analysis.sdk.uses === undefined) {
    diagnostics.push(
      issue(
        'DSHX4227',
        'warning',
        'The Client SDK uses list is dynamic, so DSHX cannot verify its service or provider requirements statically.',
        analysis.sourceFile ?? resolve(config.root, config.clientEntry),
        'Use a literal uses array for automatic checks, or run dshx check --boot --runtime to prove the composed plugin.',
      ),
    )
  }
  for (const capability of analysis.sdk?.uses ?? []) {
    if (!Object.hasOwn(CLIENT_SDK_PROVIDERS, capability)) {
      diagnostics.push(
        issue(
          'DSHX4223',
          'error',
          `Unknown Client SDK capability ${JSON.stringify(capability)}.`,
          analysis.sourceFile ?? config.packageFile,
          `Choose one of ${Object.keys(CLIENT_SDK_PROVIDERS).join(', ')} in uses.`,
        ),
      )
      continue
    }
    const missing = CLIENT_SDK_PROVIDERS[capability]!.filter(provider => !packageInject.includes(provider))
    if (missing.length)
      diagnostics.push(
        issue(
          'DSHX4222',
          'error',
          `Client capability ${JSON.stringify(capability)} needs native providers: ${missing.join(', ')}.`,
          config.packageFile,
          'Run "dshx check --fix" to add the source-derived native provider metadata, then rebuild.',
        ),
      )
  }
  for (const service of analysis.services) {
    if (
      analysis.inject !== undefined &&
      !analysis.inject.includes(service) &&
      !analysis.autoInject.includes(service) &&
      !analysis.runtimeInject.includes(service)
    ) {
      diagnostics.push(
        issue(
          'DSHX4219',
          'error',
          `defineClient().setup uses ctx.${service}, but defineClient.inject does not declare ${JSON.stringify(service)}.`,
          analysis.sourceFile ?? resolve(config.root, config.clientEntry),
          `Add inject: [${JSON.stringify(service)}] to defineClient({...}). dsh.client.inject loads provider packages; it does not inject runtime Cordis services.`,
        ),
      )
    }
    const descriptor = CLIENT_SETUP_SERVICE_CAPABILITIES[service]
    const provider = descriptor.packageName
    if (descriptor.availability === 'optional' && !packageInject.includes(provider) && !analysis.autoInject.includes(service)) {
      diagnostics.push(
        issue(
          'DSHX4220',
          'error',
          `ctx.${service} requires optional provider ${provider} in dsh.client.inject.`,
          config.packageFile,
          `Add ${JSON.stringify(provider)} to dsh.client.inject so DSH loads the provider before this Client.`,
        ),
      )
    }
  }
}

const checkFeatureCatalog = async (diagnostics: DshxDiagnostic[], config: ResolvedDshxConfig, packageManifest: JsonObject): Promise<void> => {
  if (packageManifest.dshx === undefined) return
  if (!isObject(packageManifest.dshx)) {
    diagnostics.push(
      issue(
        'DSHX4230',
        'error',
        'package.json dshx metadata must be an object.',
        config.packageFile,
        'Set dshx.features to a package-relative feature catalog path.',
      ),
    )
    return
  }
  const featurePath = packageManifest.dshx.features
  if (featurePath === undefined) return
  if (typeof featurePath !== 'string' || featurePath.trim() === '') {
    diagnostics.push(
      issue(
        'DSHX4230',
        'error',
        'package.json dshx.features must be a non-empty package-relative path.',
        config.packageFile,
        'Set dshx.features to a JSON file such as "./dshx.features.json".',
      ),
    )
    return
  }
  const featureFile = resolve(config.root, featurePath)
  const relativeFeatureFile = relative(config.root, featureFile)
  if (relativeFeatureFile === '..' || relativeFeatureFile.startsWith(`..${sep}`) || isAbsolute(relativeFeatureFile)) {
    diagnostics.push(
      issue(
        'DSHX4230',
        'error',
        'package.json dshx.features must stay inside the project root.',
        config.packageFile,
        'Move the feature catalog into this package and use a relative path.',
      ),
    )
    return
  }
  let source: string
  try {
    source = await readFile(featureFile, 'utf8')
  } catch (error) {
    diagnostics.push(
      issue(
        'DSHX4231',
        'error',
        `Cannot read DSHX feature catalog: ${String(error)}`,
        featureFile,
        'Create the referenced JSON catalog or correct dshx.features.',
      ),
    )
    return
  }
  let catalog: JsonValue
  try {
    catalog = decodeJson(jsonValueSchema, source)
  } catch (error) {
    diagnostics.push(
      issue(
        'DSHX4231',
        'error',
        `DSHX feature catalog is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        featureFile,
        'Fix the JSON syntax before running DSHX checks.',
      ),
    )
    return
  }
  for (const message of featureCatalogIssues(catalog)) {
    diagnostics.push(
      issue(
        'DSHX4232',
        'error',
        `Invalid DSHX feature catalog: ${message}`,
        featureFile,
        'Use schemaVersion 1 and link each configuration option to a declared scenario id.',
      ),
    )
  }
}

/** Collect current package and bundle metadata issues without changing project files. */
export async function checkProjectManifest(config: ResolvedDshxConfig, options: { readonly compatibility?: DshCompatibility } = {}): Promise<DshxDiagnostic[]> {
  const diagnostics: DshxDiagnostic[] = []
  let source: string
  try {
    source = await readFile(config.packageFile, 'utf8')
  } catch (error) {
    return [
      issue(
        'DSHX4101',
        'error',
        `Cannot read package.json: ${String(error)}`,
        config.packageFile,
        'Restore a readable package.json at the resolved project root.',
      ),
    ]
  }
  let manifest: JsonObject | undefined
  try {
    const decoded = decodeJsonSafe(jsonObjectSchema, source)
    if (decoded.success) manifest = decoded.data
  } catch (error) {
    return [
      issue(
        'DSHX4101',
        'error',
        `package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        config.packageFile,
        'Fix the JSON syntax before running DSHX again.',
      ),
    ]
  }
  if (manifest === undefined) {
    return [
      issue(
        'DSHX4101',
        'error',
        'package.json must contain a JSON object.',
        config.packageFile,
        'Replace the document root with a JSON object containing the package metadata.',
      ),
    ]
  }
  await checkFeatureCatalog(diagnostics, config, manifest)
  // A Host-provided package in `dependencies` resolves a second copy and only
  // fails at boot, so it is refused here where the fix can be spelled out.
  diagnostics.push(...projectHostProvidedDependencyDiagnostics(manifest, config.packageFile))
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    diagnostics.push(
      issue(
        'DSHX4101',
        'error',
        'package.json name must be a non-empty string.',
        config.packageFile,
        'Set name to the installable package id, for example "@scope/my-plugin".',
      ),
    )
  } else if (manifest.name !== config.packageId) {
    diagnostics.push(
      issue(
        'DSHX4101',
        'error',
        `package.json name changed from the resolved package id ${JSON.stringify(config.packageId)}.`,
        config.packageFile,
        'Resolve the project again before checking or restore the package name.',
      ),
    )
  }
  if (manifest.type !== 'module') {
    diagnostics.push(
      issue('DSHX4102', 'error', 'package.json type must be "module" for the Host ESM artifact.', config.packageFile, 'Set package.json type to "module".'),
    )
  }
  checkExport(diagnostics, manifest.exports, '.', './dist/index.js', 'DSHX4110', config.packageFile)
  checkExport(diagnostics, manifest.exports, './cordis.patch.yml', './cordis.patch.yml', 'DSHX4121', config.packageFile)
  checkExport(diagnostics, manifest.exports, './package.json', './package.json', 'DSHX4122', config.packageFile)

  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const bundle = isObject(dsh?.bundle) ? dsh.bundle : undefined
  if (bundle?.patch !== './cordis.patch.yml') {
    diagnostics.push(
      issue(
        'DSHX4120',
        'error',
        'package.json dsh.bundle.patch must be "./cordis.patch.yml".',
        config.packageFile,
        'Set dsh.bundle.patch to "./cordis.patch.yml".',
      ),
    )
  }
  await checkPatch(diagnostics, config.root, config.packageFile)
  checkClient(diagnostics, config, manifest, options.compatibility ?? DEFAULT_COMPATIBILITY)
  await checkSettingsCapability(diagnostics, config, manifest)
  await checkApiCapability(diagnostics, config, manifest)
  await checkConversationCapability(diagnostics, config, manifest)
  await checkLocaleCapability(diagnostics, config, manifest)
  await checkSetupServiceCapabilities(diagnostics, config, manifest)
  checkPublishingHints(diagnostics, manifest, config.packageFile)
  return diagnostics
}
